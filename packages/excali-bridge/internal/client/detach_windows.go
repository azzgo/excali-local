//go:build windows

package client

import "syscall"

// detachedSysProcAttr returns the process attributes used to detach the
// lazily-spawned daemon from the CLI's parent console/session — the Windows
// analog of Setsid (detach_unix.go). CREATE_NEW_PROCESS_GROUP (0x200) gives
// the child its own process group; DETACHED_PROCESS (0x8, not exported by
// stdlib syscall, so written as the documented Win32 literal) gives it no
// console of its own — together the daemon survives the CLI exiting.
func detachedSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x8 /* DETACHED_PROCESS */}
}
