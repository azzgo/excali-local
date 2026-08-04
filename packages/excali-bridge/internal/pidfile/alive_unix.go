//go:build !windows

package pidfile

import (
	"errors"
	"syscall"
)

// alive probes process existence with kill(pid, 0) (macOS/Linux/BSD) —
// a probe that never signals the target. Windows has no such syscall and
// uses a different probe (alive_windows.go).
func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	// kill(pid, 0) probes existence without signalling (macOS/Linux).
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
