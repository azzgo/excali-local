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
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/excali-local/excali-bridge/internal/config"
)

const (
	testAlias       = "studio-mac"
	testFingerprint = "0123456789abcdef0123456789abcdef"
)

const goroutineSlack = 2

var lanOn = config.Config{
	LAN:         config.LANOn,
	Alias:       testAlias,
	Fingerprint: testFingerprint,
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func newTestLogger(t *testing.T) *log.Logger {
	t.Helper()
	buf := &syncBuffer{}
	logger := log.New(buf, "[lan] ", 0)
	t.Cleanup(func() {
		if out := buf.String(); out != "" {
			t.Logf("lan listener log:\n%s", out)
		}
	})
	return logger
}

func startLAN(t *testing.T, cfg Config) (*Server, context.CancelFunc) {
	t.Helper()
	if cfg.Logger == nil {
		cfg.Logger = newTestLogger(t)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s, err := ListenAndServe(ctx, cfg)
	if err != nil {
		cancel()
		t.Fatalf("ListenAndServe: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		_ = s.Close()
		waitForServer(t, s)
	})
	return s, cancel
}

func waitForServer(t *testing.T, s *Server) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		s.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Server.Wait did not return")
	}
}

func waitFor(timeout time.Duration, condition func() bool) bool {
	deadline := time.Now().Add(timeout)
	for {
		if condition() {
			return true
		}
		if time.Now().After(deadline) {
			return condition()
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func isTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

type peer struct {
	conn   net.Conn
	reader *bufio.Reader
}

func dialPeer(t *testing.T, s *Server) *peer {
	t.Helper()
	return dialPeerAddr(t, fmt.Sprintf("127.0.0.1:%d", s.Port()))
}

func dialPeerAddr(t *testing.T, addr string) *peer {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return &peer{conn: conn, reader: bufio.NewReader(conn)}
}

func (p *peer) send(t *testing.T, frame map[string]any) {
	t.Helper()
	data, err := json.Marshal(frame)
	if err != nil {
		t.Fatalf("marshal frame: %v", err)
	}
	p.sendRaw(t, append(data, '\n'))
}

func (p *peer) sendRaw(t *testing.T, data []byte) {
	t.Helper()
	if err := p.conn.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatalf("set write deadline: %v", err)
	}
	if _, err := p.conn.Write(data); err != nil {
		t.Fatalf("write frame: %v", err)
	}
}

func (p *peer) receive(t *testing.T, timeout time.Duration) map[string]any {
	t.Helper()
	if err := p.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	line, err := p.reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(line), &frame); err != nil {
		t.Fatalf("decode frame %q: %v", line, err)
	}
	return frame
}

func (p *peer) tryReceive(t *testing.T, timeout time.Duration) (map[string]any, error) {
	t.Helper()
	if err := p.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return nil, err
	}
	line, err := p.reader.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	var frame map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(line), &frame); err != nil {
		return nil, fmt.Errorf("decode frame %q: %w", line, err)
	}
	return frame, nil
}

func (p *peer) drainUntilError(timeout time.Duration) error {
	if err := p.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return err
	}
	for {
		if _, err := p.reader.ReadByte(); err != nil {
			return err
		}
	}
}

func TestListenAndServeRefusesWhileTheLANSwitchIsNotOn(t *testing.T) {
	for _, switchState := range []config.LANSwitch{config.LANUnset, config.LANOff} {
		t.Run(string(switchState), func(t *testing.T) {
			s, err := ListenAndServe(context.Background(), Config{
				LAN:    config.Config{LAN: switchState},
				Logger: newTestLogger(t),
			})
			if err == nil {
				_ = s.Close()
				t.Fatal("ListenAndServe must refuse to listen while the LAN switch is not on")
			}
			if !errors.Is(err, ErrLANDisabled) {
				t.Fatalf("error = %v, want ErrLANDisabled", err)
			}
			if s != nil {
				t.Fatalf("server = %v, want nil", s)
			}
			if !strings.Contains(err.Error(), "switch is off") {
				t.Fatalf("error %q must state that the switch is off", err)
			}
		})
	}
}

func TestListenAndServeBindsAndReportsTheRealPort(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn})

	port := s.Port()
	if port == 0 {
		t.Fatal("Port must report the system-assigned port, got 0")
	}
	endpoint := s.Endpoint()
	if endpoint.Port != port {
		t.Fatalf("Endpoint().Port = %d, want %d", endpoint.Port, port)
	}
	if endpoint.Address != "0.0.0.0" {
		t.Fatalf("Endpoint().Address = %q, want 0.0.0.0", endpoint.Address)
	}
	if endpoint.String() != fmt.Sprintf("0.0.0.0:%d", port) {
		t.Fatalf("Endpoint().String() = %q, want 0.0.0.0:%d", endpoint.String(), port)
	}
	if s.Alias() != testAlias {
		t.Fatalf("Alias = %q, want %q", s.Alias(), testAlias)
	}
	if s.Fingerprint() != testFingerprint {
		t.Fatalf("Fingerprint = %q, want %q", s.Fingerprint(), testFingerprint)
	}

	dialPeer(t, s)
	if !waitFor(3*time.Second, func() bool { return s.Conns() == 1 }) {
		t.Fatalf("live connections = %d, want 1", s.Conns())
	}
}

func TestCloseReleasesThePortForAnImmediateRebind(t *testing.T) {
	s, _ := startLAN(t, Config{LAN: lanOn})
	port := s.Port()

	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	waitForServer(t, s)

	if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond); err == nil {
		_ = conn.Close()
		t.Fatalf("port %d still accepts connections after Close", port)
	}

	rebound, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		t.Fatalf("rebind port %d after Close: %v", port, err)
	}
	_ = rebound.Close()
}

func TestContextCancelDropsEveryConnectionAndWaitReturns(t *testing.T) {
	s, cancel := startLAN(t, Config{LAN: lanOn, ReadTimeout: 30 * time.Second})

	peers := []*peer{dialPeer(t, s), dialPeer(t, s), dialPeer(t, s)}
	if !waitFor(3*time.Second, func() bool { return s.Conns() == 3 }) {
		t.Fatalf("live connections = %d, want 3", s.Conns())
	}

	cancel()
	waitForServer(t, s)

	for i, p := range peers {
		err := p.drainUntilError(3 * time.Second)
		if err == nil {
			t.Fatalf("peer %d is still connected after the context was cancelled", i)
		}
		if isTimeout(err) {
			t.Fatalf("peer %d was not dropped after the context was cancelled: %v", i, err)
		}
	}
	if !waitFor(3*time.Second, func() bool { return s.Conns() == 0 }) {
		t.Fatalf("live connections = %d, want 0", s.Conns())
	}
}

func TestIdleConnectionIsDroppedAfterTheReadTimeout(t *testing.T) {
	const readTimeout = 300 * time.Millisecond
	s, _ := startLAN(t, Config{LAN: lanOn, ReadTimeout: readTimeout, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	if !waitFor(3*time.Second, func() bool { return s.Conns() == 1 }) {
		t.Fatalf("live connections = %d, want 1", s.Conns())
	}

	started := time.Now()
	err := p.drainUntilError(5 * time.Second)
	elapsed := time.Since(started)
	if err == nil {
		t.Fatal("the idle connection was never dropped")
	}
	if isTimeout(err) {
		t.Fatalf("the idle connection survived the %s read timeout: %v", readTimeout, err)
	}
	if elapsed < readTimeout/2 {
		t.Fatalf("the idle connection was dropped after %s, want about %s", elapsed, readTimeout)
	}
	if !waitFor(3*time.Second, func() bool { return s.Conns() == 0 }) {
		t.Fatalf("live connections = %d, want 0", s.Conns())
	}
}

func TestActiveConnectionSurvivesTheReadTimeout(t *testing.T) {
	const readTimeout = 500 * time.Millisecond
	handler := &offerHandler{
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "t", "token": "tok"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: readTimeout, WriteTimeout: 5 * time.Second})

	p := dialPeer(t, s)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			payload, err := json.Marshal(map[string]any{"type": TypeOffer, "transferId": "t"})
			if err != nil {
				return
			}
			_ = p.conn.SetWriteDeadline(time.Now().Add(time.Second))
			if _, err := p.conn.Write(append(payload, '\n')); err != nil {
				return
			}
			time.Sleep(readTimeout / 5)
		}
	}()

	received := 0
	deadline := time.Now().Add(readTimeout * 4)
	for time.Now().Before(deadline) {
		reply, err := p.tryReceive(t, 2*time.Second)
		if err != nil {
			close(stop)
			wg.Wait()
			t.Fatalf("the active connection was dropped after %d replies: %v", received, err)
		}
		if reply["type"] != TypeAccept {
			close(stop)
			wg.Wait()
			t.Fatalf("reply = %v, want %s", reply, TypeAccept)
		}
		received++
	}
	close(stop)
	wg.Wait()

	if received < 2 {
		t.Fatalf("received %d replies, want the connection to stay alive past the read timeout", received)
	}
	if s.Conns() != 1 {
		t.Fatalf("live connections = %d, want 1 (an active peer must survive the read timeout)", s.Conns())
	}
}

func TestWriteToAStalledPeerHitsTheWriteTimeout(t *testing.T) {
	const writeTimeout = 300 * time.Millisecond
	const payloadSize = 16 << 20
	handler := &offerHandler{
		replies: map[string]Reply{
			"stall": {
				Type: TypeAccept,
				Fields: map[string]any{
					"transferId": "stall",
					"token":      "tok",
					"blob":       strings.Repeat("x", payloadSize),
				},
			},
		},
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "small", "token": "tok"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 30 * time.Second, WriteTimeout: writeTimeout})

	stalled := dialPeer(t, s)
	if tcp, ok := stalled.conn.(*net.TCPConn); ok {
		_ = tcp.SetReadBuffer(1024)
	}
	stalled.send(t, map[string]any{"type": TypeOffer, "transferId": "stall"})

	sent := time.Now()
	if !waitFor(writeTimeout+3*time.Second, func() bool { return s.Conns() == 0 }) {
		t.Fatalf("the stalled peer was not disconnected (live connections = %d)", s.Conns())
	}
	if elapsed := time.Since(sent); elapsed > writeTimeout+3*time.Second {
		t.Fatalf("the write took %s to give up, want about %s", elapsed, writeTimeout)
	}
	other := dialPeer(t, s)
	other.send(t, map[string]any{"type": TypeOffer, "transferId": "small"})
	reply := other.receive(t, 5*time.Second)
	if reply["type"] != TypeAccept || reply["transferId"] != "small" {
		t.Fatalf("reply = %v, want the small accept", reply)
	}
}

func TestConcurrentPeersAreServedAndNothingLeaks(t *testing.T) {
	const peerCount = 12
	baseline := runtime.NumGoroutine()
	handler := &offerHandler{
		fallback: Reply{Type: TypeAccept, Fields: map[string]any{"transferId": "t", "token": "tok"}},
	}
	s, _ := startLAN(t, Config{LAN: lanOn, Handler: handler, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second})

	var wg sync.WaitGroup
	errs := make(chan error, peerCount)
	for i := 0; i < peerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := exchangeOffer(s, "t"); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}

	if !waitFor(3*time.Second, func() bool { return s.connsStarted.Load() == peerCount }) {
		t.Fatalf("the listener started %d connection goroutines, want %d", s.connsStarted.Load(), peerCount)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	waitForServer(t, s)

	if !waitFor(3*time.Second, func() bool { return s.connsEnded.Load() == peerCount }) {
		t.Fatalf("the listener ended %d connection goroutines, want %d", s.connsEnded.Load(), peerCount)
	}
	if s.Conns() != 0 {
		t.Fatalf("live connections = %d, want 0", s.Conns())
	}
	if !waitFor(5*time.Second, func() bool { return runtime.NumGoroutine() <= baseline+goroutineSlack }) {
		t.Fatalf("goroutines = %d, want at most %d (baseline %d)", runtime.NumGoroutine(), baseline+goroutineSlack, baseline)
	}
}

func exchangeOffer(s *Server, transferID string) error {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", s.Port()), 3*time.Second)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	reader := bufio.NewReader(conn)

	payload, err := json.Marshal(map[string]any{"type": TypeOffer, "transferId": transferID})
	if err != nil {
		return fmt.Errorf("marshal offer: %w", err)
	}
	if err := conn.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return fmt.Errorf("set write deadline: %w", err)
	}
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		return fmt.Errorf("write offer: %w", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return fmt.Errorf("set read deadline: %w", err)
	}
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return fmt.Errorf("read reply: %w", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(line), &frame); err != nil {
		return fmt.Errorf("decode reply %q: %w", line, err)
	}
	if frame["type"] != TypeAccept {
		return fmt.Errorf("reply = %v, want %s", frame, TypeAccept)
	}
	return nil
}
