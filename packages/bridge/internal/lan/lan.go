// Package lan implements the LAN listener: the Bridge daemon's second
// listening surface (ADR 0013 decision 2, docs/PEERING.md).
//
// The LAN listener is a separate surface, not a second setting of the
// loopback one:
//
//   - it is off by default and opens only on an explicit user act;
//   - it binds 0.0.0.0 on a system-assigned ephemeral port;
//   - it carries Canvas transfer frames only — never the Leg-A JSON-RPC
//     method set, never a page route, never the single-active-canvas slot;
//   - it applies no origin allow-list: a Go peer sends no Origin header, and
//     the loopback allow-list rejects an empty Origin.
//
// The wire is raw TCP with one JSON object per line (newline framed). A peer
// sends no HTTP and no Origin, so there is nothing for an origin allow-list
// to inspect; the listener therefore owns its own framing instead of reusing
// the loopback surface's WebSocket handshake.
//
// Every frame that is not a transfer frame is answered with an explicit error
// frame; nothing is dropped silently.
package lan

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/excali-local/excali-bridge/internal/config"
)

const (
	// defaultBindAddress is the LAN listener's bind address: every
	// interface, so a peer on the same network can reach it.
	defaultBindAddress = "0.0.0.0"

	// defaultReadTimeout is the per-frame idle deadline. It outlasts the 60s
	// offer deadline: the receiver holds an unanswered offer in memory for a
	// minute, and the sender's connection must survive that silence.
	defaultReadTimeout = 120 * time.Second

	// defaultWriteTimeout bounds one frame write.
	defaultWriteTimeout = 30 * time.Second

	// maxFrameBytes caps one frame. A 200KB chunk is base64-encoded (~267KB)
	// before it goes on the wire, so the cap leaves room for the encoding and
	// the frame overhead.
	maxFrameBytes = 1 << 20

	initialFrameBuffer = 64 << 10
)

// ErrLANDisabled is returned when the LAN listener is asked to bind while the
// LAN switch says off.
var ErrLANDisabled = errors.New("lan: the LAN listener switch is off")

// Config is the LAN listener configuration.
type Config struct {
	// LAN is the daemon's effective configuration. The listener binds only
	// while its LAN switch says on.
	LAN config.Config

	// Handler answers the transfer frames. A nil handler means no transfer
	// handling is wired yet: every transfer frame is then answered with an
	// explicit error frame.
	Handler Handler

	// Logger receives the listener's logs.
	Logger *log.Logger

	// BindAddress overrides the bind address (default 0.0.0.0).
	BindAddress string

	// ReadTimeout is the per-frame idle deadline on a connection.
	ReadTimeout time.Duration

	// WriteTimeout bounds one frame write.
	WriteTimeout time.Duration
}

// Endpoint is the bound LAN listener address, for the mDNS announcement.
type Endpoint struct {
	// Address is the bind address (0.0.0.0 by default).
	Address string

	// Port is the system-assigned ephemeral port.
	Port int
}

// String renders the endpoint as host:port.
func (e Endpoint) String() string {
	return net.JoinHostPort(e.Address, strconv.Itoa(e.Port))
}

// Server is the running LAN listener.
type Server struct {
	endpoint     Endpoint
	handler      Handler
	lanConfig    config.Config
	log          *log.Logger
	readTimeout  time.Duration
	writeTimeout time.Duration

	listener net.Listener
	ctx      context.Context
	cancel   context.CancelFunc

	mu    sync.Mutex
	conns map[net.Conn]struct{}

	connsStarted atomic.Int64
	connsEnded   atomic.Int64

	acceptDone chan struct{}
	connWg     sync.WaitGroup
	closeOnce  sync.Once
}

// ListenAndServe binds the LAN listener and serves it in the background
// until ctx is cancelled. It returns as soon as the listener is bound, so the
// caller can announce the endpoint over mDNS before any peer dials.
func ListenAndServe(ctx context.Context, cfg Config) (*Server, error) {
	if !cfg.LAN.LANEnabled() {
		return nil, ErrLANDisabled
	}
	bindAddress := cfg.BindAddress
	if bindAddress == "" {
		bindAddress = defaultBindAddress
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bindAddress, "0"))
	if err != nil {
		return nil, fmt.Errorf("lan: bind %s: %w", bindAddress, err)
	}
	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		_ = listener.Close()
		return nil, fmt.Errorf("lan: unexpected listener address %v", listener.Addr())
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.New(os.Stderr, "[bridge:lan] ", log.LstdFlags)
	}
	readTimeout := cfg.ReadTimeout
	if readTimeout <= 0 {
		readTimeout = defaultReadTimeout
	}
	writeTimeout := cfg.WriteTimeout
	if writeTimeout <= 0 {
		writeTimeout = defaultWriteTimeout
	}
	serverCtx, cancel := context.WithCancel(ctx)
	s := &Server{
		endpoint:     Endpoint{Address: bindAddress, Port: tcpAddr.Port},
		handler:      cfg.Handler,
		lanConfig:    cfg.LAN,
		log:          logger,
		readTimeout:  readTimeout,
		writeTimeout: writeTimeout,
		listener:     listener,
		ctx:          serverCtx,
		cancel:       cancel,
		conns:        map[net.Conn]struct{}{},
		acceptDone:   make(chan struct{}),
	}
	s.log.Printf("listening on %s (LAN listener, Canvas transfer only)", s.endpoint)
	go s.acceptLoop()
	go func() {
		<-serverCtx.Done()
		s.Close()
	}()
	return s, nil
}

// Endpoint returns the bound address and port.
func (s *Server) Endpoint() Endpoint { return s.endpoint }

// Port returns the bound port.
func (s *Server) Port() int { return s.endpoint.Port }

// Alias returns the device alias peers see.
func (s *Server) Alias() string { return s.lanConfig.Alias }

// Fingerprint returns the device fingerprint: identification only, never a
// credential.
func (s *Server) Fingerprint() string { return s.lanConfig.Fingerprint }

// Conns returns the number of live peer connections.
func (s *Server) Conns() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.conns)
}

// Wait blocks until the listener is closed and every connection goroutine has
// finished. The accept loop is the only writer to the connection wait group,
// so it must be finished before the wait group is read.
func (s *Server) Wait() {
	<-s.acceptDone
	s.connWg.Wait()
}

// Close stops accepting, disconnects every live peer connection, and releases
// the port.
func (s *Server) Close() error {
	s.closeOnce.Do(func() {
		s.cancel()
		_ = s.listener.Close()
		s.mu.Lock()
		conns := make([]net.Conn, 0, len(s.conns))
		for conn := range s.conns {
			conns = append(conns, conn)
		}
		s.conns = map[net.Conn]struct{}{}
		s.mu.Unlock()
		for _, conn := range conns {
			_ = conn.Close()
		}
		s.log.Printf("closed")
	})
	return nil
}

func (s *Server) acceptLoop() {
	defer close(s.acceptDone)
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			if s.ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return
			}
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() {
				continue
			}
			s.log.Printf("accept: %v", err)
			return
		}
		s.mu.Lock()
		s.conns[conn] = struct{}{}
		s.mu.Unlock()
		s.connWg.Add(1)
		go s.serveConn(conn)
	}
}

func (s *Server) serveConn(conn net.Conn) {
	s.connsStarted.Add(1)
	defer s.connsEnded.Add(1)
	defer s.connWg.Done()
	defer s.removeConn(conn)
	defer conn.Close()

	peer := Peer{Address: conn.RemoteAddr().String()}
	frames := bufio.NewScanner(conn)
	frames.Buffer(make([]byte, 0, initialFrameBuffer), maxFrameBytes)
	for {
		if err := conn.SetReadDeadline(time.Now().Add(s.readTimeout)); err != nil {
			return
		}
		if !frames.Scan() {
			err := frames.Err()
			switch {
			case errors.Is(err, bufio.ErrTooLong):
				s.writeErrorFrame(conn, CodeFrameTooLarge,
					fmt.Sprintf("a frame may not exceed %d bytes", maxFrameBytes))
			case err != nil:
				s.log.Printf("conn %s: read: %v", peer.Address, err)
			}
			return
		}
		line := bytes.TrimSpace(frames.Bytes())
		if len(line) == 0 {
			continue
		}
		msg, parseErr := parseMessage(line)
		if parseErr != nil {
			s.writeErrorFrame(conn, parseErr.code, parseErr.message)
			continue
		}
		if !s.handleFrame(conn, peer, msg) {
			return
		}
	}
}

func (s *Server) handleFrame(conn net.Conn, peer Peer, msg Message) bool {
	if !IsTransferType(msg.Type) {
		s.writeErrorFrame(conn, CodeUnsupportedType,
			fmt.Sprintf("unsupported message type %q: the LAN listener carries Canvas transfer only", msg.Type))
		return true
	}
	if s.handler == nil {
		s.writeErrorFrame(conn, CodeNoHandler, "this daemon has no Canvas transfer handler wired")
		return true
	}
	reply, err := s.handler.HandleTransfer(s.ctx, peer, msg)
	if err != nil {
		s.writeErrorFrame(conn, CodeHandlerFailed, err.Error())
		return true
	}
	if reply.Type == "" {
		return true
	}
	if !s.writeReplyFrame(conn, reply) {
		return false
	}
	return !reply.Close
}

func (s *Server) writeReplyFrame(conn net.Conn, reply Reply) bool {
	frame := make(map[string]any, len(reply.Fields)+1)
	for key, value := range reply.Fields {
		frame[key] = value
	}
	frame["type"] = reply.Type
	return s.writeFrame(conn, frame)
}

func (s *Server) writeErrorFrame(conn net.Conn, code, message string) bool {
	return s.writeFrame(conn, map[string]any{
		"type":    TypeError,
		"code":    code,
		"message": message,
	})
}

func (s *Server) writeFrame(conn net.Conn, frame map[string]any) bool {
	if err := conn.SetWriteDeadline(time.Now().Add(s.writeTimeout)); err != nil {
		return false
	}
	data, err := json.Marshal(frame)
	if err != nil {
		return false
	}
	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		return false
	}
	return true
}

func (s *Server) removeConn(conn net.Conn) {
	s.mu.Lock()
	delete(s.conns, conn)
	s.mu.Unlock()
}
