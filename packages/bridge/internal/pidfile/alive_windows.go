//go:build windows

package pidfile

import (
	"errors"
	"os"
	"syscall"
)

// alive probes process existence on Windows. os.FindProcess performs a real
// OpenProcess lookup and returns an error for a nonexistent pid, so a
// nil error means the process exists.
//
// ACCESS_DENIED (Errno 5, e.g. a process owned by another user or otherwise
// not probeable) is treated as ALIVE: we must never false-negative a live
// same-user daemon, and a false positive is neutralized by the design rule
// that callers verify the daemon actually answers (health/handshake) before
// trusting a pidfile (see Alive's doc comment in pidfile.go).
func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	_, err := os.FindProcess(pid)
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.ERROR_ACCESS_DENIED)
}
