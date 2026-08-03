// Package pidfile implements the daemon single-instance mechanism
// (Wayfinder Ticket 017): a fixed-path pidfile holding pid + port ONLY —
// never the token (Ticket 011: the per-session token is rotated and never
// persisted or logged).
package pidfile

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// Info is the pidfile payload. Deliberately minimal: {pid, port}.
type Info struct {
	PID  int `json:"pid"`
	Port int `json:"port"`
}

// Path returns the pidfile path: $EXCALI_BRIDGE_PIDFILE if set (tests /
// non-standard setups), else ~/.excali-local/bridge.pid (Ticket 017's
// fixed path under a per-user location).
func Path() (string, error) {
	if p := os.Getenv("EXCALI_BRIDGE_PIDFILE"); p != "" {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return filepath.Join(home, ".excali-local", "bridge.pid"), nil
}

// Dir returns the directory the pidfile lives in (used for the daemon log).
func Dir() (string, error) {
	p, err := Path()
	if err != nil {
		return "", err
	}
	return filepath.Dir(p), nil
}

// Read loads the pidfile. Returns an error when missing or malformed.
func Read() (*Info, error) {
	return ReadAt("")
}

// ReadAt loads the pidfile at path ("" = default path).
func ReadAt(path string) (*Info, error) {
	if path == "" {
		p, err := Path()
		if err != nil {
			return nil, err
		}
		path = p
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var info Info
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, fmt.Errorf("malformed pidfile: %w", err)
	}
	if info.PID <= 0 || info.Port <= 0 {
		return nil, errors.New("invalid pidfile: pid/port missing")
	}
	return &info, nil
}

// Write atomically writes the pidfile (temp + rename).
func Write(pid, port int) error {
	return WriteAt("", pid, port)
}

// WriteAt atomically writes the pidfile at path ("" = default path).
func WriteAt(path string, pid, port int) error {
	if path == "" {
		p, err := Path()
		if err != nil {
			return err
		}
		path = p
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(Info{PID: pid, Port: port})
	if err != nil {
		return err
	}
	data = append(data, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Remove deletes the pidfile (best-effort; ignores not-exists).
func Remove() {
	RemoveAt("")
}

// RemoveAt deletes the pidfile at path ("" = default path).
func RemoveAt(path string) {
	if path == "" {
		p, err := Path()
		if err != nil {
			return
		}
		path = p
	}
	_ = os.Remove(path)
}

// Alive reports whether a process with the given PID exists (same OS user).
// A reused PID passes here — callers must additionally verify the daemon
// actually answers (health / handshake) before trusting a pidfile.
func Alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	// kill(pid, 0) probes existence without signalling (macOS/Linux).
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
