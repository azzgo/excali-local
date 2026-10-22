// Package paths resolves the directories the Bridge daemon keeps its mutable
// state and its user configuration in (ADR 0012 decision 5): state and config
// leave the home dot-directory, follow the platform convention, and stay
// separate from each other. The legacy ~/.excali-local location is only read,
// once, to relocate files that predate the move.
package paths

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

const (
	// AppDir is the directory name used under every platform base.
	AppDir = "excali-local"
	// LegacyAppDir is the pre-ADR-0012 home directory name.
	LegacyAppDir = ".excali-local"
	// EnvStateDir overrides the state directory.
	EnvStateDir = "EXCALI_BRIDGE_STATE_DIR"
	// EnvConfigDir overrides the config directory.
	EnvConfigDir = "EXCALI_BRIDGE_CONFIG_DIR"
)

var migrationMu sync.Mutex

// StateDir returns the directory holding mutable daemon state (pidfile, log).
// $EXCALI_BRIDGE_STATE_DIR wins when set; otherwise the platform convention
// applies: $XDG_STATE_HOME/excali-local (Linux, default
// ~/.local/state/excali-local), ~/Library/Application Support/excali-local
// (macOS), %LOCALAPPDATA%\excali-local (Windows).
func StateDir() (string, error) {
	if dir := os.Getenv(EnvStateDir); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return stateDirFor(runtime.GOOS, home, os.Getenv("XDG_STATE_HOME"), os.Getenv("LOCALAPPDATA")), nil
}

// ConfigDir returns the directory holding the daemon's user configuration.
// $EXCALI_BRIDGE_CONFIG_DIR wins when set; otherwise the platform convention
// applies: $XDG_CONFIG_HOME/excali-local (Linux, default
// ~/.config/excali-local), and the state directory on macOS and Windows,
// where the platform keeps both together.
func ConfigDir() (string, error) {
	if dir := os.Getenv(EnvConfigDir); dir != "" {
		return dir, nil
	}
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		return StateDir()
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return configDirFor(runtime.GOOS, home, os.Getenv("XDG_CONFIG_HOME"), os.Getenv("LOCALAPPDATA")), nil
}

// LegacyDir returns the pre-ADR-0012 home directory (~/.excali-local). It is
// a read source for the one-time relocation only; nothing writes there.
func LegacyDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return filepath.Join(home, LegacyAppDir), nil
}

// MigrateStateFile copies name from the legacy directory into the state
// directory when the target does not exist yet.
func MigrateStateFile(name string) (bool, error) {
	dir, err := StateDir()
	if err != nil {
		return false, err
	}
	return MigrateFile(name, dir)
}

// MigrateConfigFile copies name from the legacy directory into the config
// directory when the target does not exist yet.
func MigrateConfigFile(name string) (bool, error) {
	dir, err := ConfigDir()
	if err != nil {
		return false, err
	}
	return MigrateFile(name, dir)
}

// MigrateFile copies name from the legacy directory into dstDir. The copy
// happens only when dstDir/name does not exist, so the call is idempotent and
// never overwrites a newer file. The legacy file is left in place as a
// tombstone. The returned bool reports whether a copy happened.
func MigrateFile(name, dstDir string) (bool, error) {
	if name == "" || dstDir == "" {
		return false, nil
	}

	migrationMu.Lock()
	defer migrationMu.Unlock()

	dst := filepath.Join(dstDir, name)
	switch _, err := os.Stat(dst); {
	case err == nil:
		return false, nil
	case !os.IsNotExist(err):
		return false, fmt.Errorf("stat %s: %w", dst, err)
	}

	legacy, err := LegacyDir()
	if err != nil {
		return false, err
	}
	src := filepath.Join(legacy, name)
	data, err := os.ReadFile(src)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("read legacy %s: %w", src, err)
	}

	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return false, fmt.Errorf("create %s: %w", dstDir, err)
	}
	if err := createIfAbsent(dst, data, 0o644); err != nil {
		return false, fmt.Errorf("write %s: %w", dst, err)
	}
	return true, nil
}

// createIfAbsent writes data to dst only when dst does not exist yet: the
// content lands through a temporary file, so a reader never sees a half
// written file, and the final link step keeps a concurrent creator from
// being overwritten.
func createIfAbsent(dst string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(dst)
	tmp, err := os.CreateTemp(dir, ".migrate-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Link(tmpName, dst); err == nil {
		return nil
	}
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	return os.Rename(tmpName, dst)
}

func stateDirFor(goos, home, xdgStateHome, localAppData string) string {
	switch goos {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", AppDir)
	case "windows":
		base := localAppData
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, AppDir)
	default:
		base := xdgStateHome
		if base == "" {
			base = filepath.Join(home, ".local", "state")
		}
		return filepath.Join(base, AppDir)
	}
}

func configDirFor(goos, home, xdgConfigHome, localAppData string) string {
	switch goos {
	case "darwin", "windows":
		return stateDirFor(goos, home, xdgConfigHome, localAppData)
	default:
		base := xdgConfigHome
		if base == "" {
			base = filepath.Join(home, ".config")
		}
		return filepath.Join(base, AppDir)
	}
}
