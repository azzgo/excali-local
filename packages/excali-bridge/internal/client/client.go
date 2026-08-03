// Package client implements the Leg-A agent CLI: connect to the daemon over
// WS, authenticate with an origin + ≥128-bit token handshake (role "agent" —
// never claiming the active-page slot), and issue versioned minimal JSON-RPC
// requests (ADR 0001). The daemon is started lazily on first use (Ticket 009)
// via the pidfile single-instance mechanism (Ticket 017).
package client

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"github.com/excali-local/excali-bridge/internal/ws"
)

// Origin is the origin the CLI presents in the WS upgrade + handshake. It is
// the same chrome-extension://<id> shape (32 chars of [a-p]) the browser
// pages present — a same-user local process spoofing it is exactly Ticket
// 011's layer-5 residual (accepted for a personal local-first tool; pairing
// and activation are the human consent gates, not this header).
const Origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

// Options configures a CLI invocation.
type Options struct {
	// BinPath is the path to this binary, used to spawn the daemon lazily.
	// Defaults to os.Executable().
	BinPath string
	// Pidfile overrides the pidfile location ("" = default / env).
	Pidfile string
	// Timeout bounds each network step (dial, handshake, rpc).
	Timeout time.Duration
	// SpawnTimeout bounds waiting for a lazily-spawned daemon to come up.
	SpawnTimeout time.Duration
	// Stdout/Stderr receive CLI output (default os.Stdout/os.Stderr).
	Stdout io.Writer
	Stderr io.Writer
}

func (o *Options) fill() {
	if o.Timeout <= 0 {
		o.Timeout = 10 * time.Second
	}
	if o.SpawnTimeout <= 0 {
		o.SpawnTimeout = 5 * time.Second
	}
	if o.Stdout == nil {
		o.Stdout = os.Stdout
	}
	if o.Stderr == nil {
		o.Stderr = os.Stderr
	}
}

func mintToken() (string, error) {
	b := make([]byte, 32) // 256 bits
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func healthOK(port int) bool {
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var h map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		return false
	}
	return h["ok"] == true
}

// EnsureDaemon returns the port of a running bridge daemon, lazily spawning it
// (detached, logging to ~/.excali-local/bridge.log) when none is up.
func EnsureDaemon(ctx context.Context, opts Options) (int, error) {
	opts.fill()
	// 1. pidfile: live pid + a daemon actually answering on its port → reuse.
	if info, err := pidfile.ReadAt(opts.Pidfile); err == nil && pidfile.Alive(info.PID) {
		if healthOK(info.Port) {
			return info.Port, nil
		}
	}
	// 2. stale pidfile → clean up, then spawn lazily (Ticket 009).
	pidfile.RemoveAt(opts.Pidfile)
	if err := spawnDaemon(opts); err != nil {
		return 0, fmt.Errorf("spawn daemon: %w", err)
	}
	deadline := time.Now().Add(opts.SpawnTimeout)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
		if info, err := pidfile.ReadAt(opts.Pidfile); err == nil && pidfile.Alive(info.PID) {
			if healthOK(info.Port) {
				return info.Port, nil
			}
		}
	}
	return 0, errors.New("daemon did not come up in time")
}

// spawnDaemon starts `serve` detached with logs appended to
// ~/.excali-local/bridge.log. The daemon writes the pidfile itself after
// binding; two concurrent spawns are resolved by the bind race + the
// already-running check inside serve.
func spawnDaemon(opts Options) error {
	bin := opts.BinPath
	if bin == "" {
		b, err := os.Executable()
		if err != nil {
			return err
		}
		bin = b
	}
	dir, err := pidfile.Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	logPath := filepath.Join(dir, "bridge.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, "serve")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} // detach from the CLI's session
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return err
	}
	return nil
}

// Ping performs a JSON-RPC `ping` round-trip against the daemon (subcommand ==
// method). It returns the decoded result ("pong") or an error.
func Ping(ctx context.Context, opts Options) (string, error) {
	opts.fill()
	port, err := EnsureDaemon(ctx, opts)
	if err != nil {
		return "", err
	}
	c, err := ws.Dial(ctx, fmt.Sprintf("127.0.0.1:%d", port), Origin, opts.Timeout)
	if err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}
	defer c.Close()

	token, err := mintToken() // per-invocation, never logged
	if err != nil {
		return "", err
	}
	handshake := map[string]any{
		"type":    contract.WSHandshake,
		"token":   token,
		"origin":  Origin,
		"role":    contract.RoleAgent,
		"version": contract.LegAProtocolVersion,
	}
	if err := writeJSON(c, handshake); err != nil {
		return "", err
	}
	reply, err := readJSON(c)
	if err != nil {
		return "", err
	}
	if t, _ := reply["type"].(string); t != contract.WSHandshakeOK {
		return "", fmt.Errorf("handshake rejected: %v", reply["reason"])
	}

	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping", "params": map[string]any{}}
	if err := writeJSON(c, req); err != nil {
		return "", err
	}
	resp, err := readJSON(c)
	if err != nil {
		return "", err
	}
	if errObj, ok := resp["error"].(map[string]any); ok {
		return "", fmt.Errorf("rpc error %v: %v", errObj["code"], errObj["message"])
	}
	result, _ := resp["result"].(string)
	return result, nil
}

func writeJSON(c *ws.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.WriteText(data)
}

func readJSON(c *ws.Conn) (map[string]any, error) {
	data, err := c.ReadMessage()
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}
