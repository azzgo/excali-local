// Package pidfile implements the daemon single-instance mechanism
// (Wayfinder Ticket 017): a fixed-path pidfile holding pid + port ONLY —
// never the token (Ticket 011: the per-session token is rotated and never
// persisted or logged). The pidfile lives in the platform state directory
// (ADR 0012 decision 5); the pre-move location is read once so an upgrade
// never leaves two daemons running.
package pidfile

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/excali-local/excali-bridge/internal/paths"
)

// Info is the pidfile payload. Deliberately minimal: {pid, port}.
type Info struct {
	PID  int `json:"pid"`
	Port int `json:"port"`
}

// Path returns the pidfile path: $EXCALI_BRIDGE_PIDFILE if set (tests /
// non-standard setups), else bridge.pid inside the platform state directory
// (ADR 0012 decision 5).
func Path() (string, error) {
	if p := os.Getenv("EXCALI_BRIDGE_PIDFILE"); p != "" {
		return p, nil
	}
	dir, err := paths.StateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "bridge.pid"), nil
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

// ReadAt loads the pidfile at path ("" = default path). The default path
// first relocates a pidfile left in the legacy home directory: reading the
// old location keeps an upgraded install on the running daemon instead of
// starting a second one.
func ReadAt(path string) (*Info, error) {
	if path == "" {
		p, err := Path()
		if err != nil {
			return nil, err
		}
		path = p
		migrateLegacy(path)
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

// migrateLegacy copies a pidfile from the pre-ADR-0012 home directory to
// the state directory. Failures are not fatal: a missing legacy file is the
// normal case.
func migrateLegacy(dst string) {
	if os.Getenv("EXCALI_BRIDGE_PIDFILE") != "" {
		return
	}
	_, _ = paths.MigrateStateFile(filepath.Base(dst))
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
//
// The probe is platform-specific: kill(pid, 0) on Unix (alive_unix.go),
// an os.FindProcess lookup on Windows (alive_windows.go).
func Alive(pid int) bool {
	return alive(pid)
}
