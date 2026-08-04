//go:build !windows

package client

import "syscall"

// detachedSysProcAttr returns the process attributes used to detach the
// lazily-spawned daemon from the CLI's session. On Unix: Setsid (a new
// session, so the daemon survives the CLI exiting). Windows uses different
// creation flags (detach_windows.go).
func detachedSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
