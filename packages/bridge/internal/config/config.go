// Package config holds the Bridge daemon's user configuration (ADR 0013):
// the LAN listener switch, the device alias, and the device fingerprint. The
// file lives in the platform config directory (ADR 0012 decision 5) and holds
// no secret — the fingerprint identifies a device, it never authenticates one.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/excali-local/excali-bridge/internal/paths"
)

// FileName is the configuration file name inside the config directory.
const FileName = "config.json"

// LANSwitch is the persisted state of the LAN listener switch.
type LANSwitch string

const (
	// LANUnset means the user never decided: the LAN listener stays closed.
	LANUnset LANSwitch = "unset"
	// LANOn means the user persisted the LAN listener as open.
	LANOn LANSwitch = "on"
	// LANOff means the user persisted the LAN listener as closed.
	LANOff LANSwitch = "off"
)

// Config is the daemon's effective configuration.
type Config struct {
	// LAN is the persisted LAN listener switch.
	LAN LANSwitch
	// Alias is the device alias peers see; the machine hostname when the
	// user never set one.
	Alias string
	// Fingerprint is the device fingerprint: identification only.
	Fingerprint string
}

// LANEnabled reports whether the LAN listener may be opened. A never-decided
// switch keeps the listener closed.
func (c Config) LANEnabled() bool { return c.LAN == LANOn }

// fileConfig is the on-disk shape of config.json.
type fileConfig struct {
	LAN         LANSwitch `json:"lan"`
	Alias       string    `json:"alias"`
	Fingerprint string    `json:"fingerprint"`
}

var mu sync.Mutex

// Path returns the configuration file path.
func Path() (string, error) {
	dir, err := paths.ConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, FileName), nil
}

// Load reads the configuration from the config directory. A missing file
// yields the defaults (LAN unset, alias = hostname). The device fingerprint
// is minted once on the first read and persisted from then on.
func Load() (Config, error) {
	mu.Lock()
	defer mu.Unlock()

	stored, err := read()
	if err != nil {
		return Config{}, err
	}
	c := effective(stored)
	if c.Fingerprint == "" {
		fingerprint, err := newFingerprint()
		if err != nil {
			return c, err
		}
		stored.Fingerprint = fingerprint
		if err := save(stored); err != nil {
			return c, err
		}
		c.Fingerprint = fingerprint
	}
	return c, nil
}

// SetLAN persists the LAN listener switch.
func SetLAN(lan LANSwitch) error {
	mu.Lock()
	defer mu.Unlock()

	switch lan {
	case LANOn, LANOff:
	case LANUnset, "":
		lan = LANUnset
	default:
		return fmt.Errorf("unknown lan switch %q", lan)
	}

	stored, err := read()
	if err != nil {
		return err
	}
	stored.LAN = lan
	return save(stored)
}

// SetAlias persists the device alias. An empty alias restores the default
// (the machine hostname).
func SetAlias(alias string) error {
	mu.Lock()
	defer mu.Unlock()

	stored, err := read()
	if err != nil {
		return err
	}
	stored.Alias = alias
	return save(stored)
}

// EnsureFingerprint returns the persisted device fingerprint, minting one on
// first use. The fingerprint identifies the device to other peers; it is not
// a credential and grants no access.
func EnsureFingerprint() (string, error) {
	c, err := Load()
	if err != nil {
		return "", err
	}
	return c.Fingerprint, nil
}

func read() (fileConfig, error) {
	stored := fileConfig{LAN: LANUnset}

	_, _ = paths.MigrateConfigFile(FileName)

	path, err := Path()
	if err != nil {
		return stored, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return stored, nil
		}
		return stored, fmt.Errorf("read %s: %w", path, err)
	}

	var parsed fileConfig
	if err := json.Unmarshal(data, &parsed); err != nil {
		return stored, fmt.Errorf("malformed config %s: %w", path, err)
	}
	if parsed.LAN == LANOn || parsed.LAN == LANOff {
		stored.LAN = parsed.LAN
	}
	stored.Alias = parsed.Alias
	stored.Fingerprint = parsed.Fingerprint
	return stored, nil
}

func effective(stored fileConfig) Config {
	c := Config{LAN: stored.LAN, Fingerprint: stored.Fingerprint}
	c.Alias = stored.Alias
	if c.Alias == "" {
		c.Alias = defaultAlias()
	}
	return c
}

func save(c fileConfig) error {
	if c.LAN == "" {
		c.LAN = LANUnset
	}

	path, err := Path()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(dir, ".config-*.json")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func defaultAlias() string {
	host, err := os.Hostname()
	if err != nil {
		return ""
	}
	return host
}

func newFingerprint() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("fingerprint: %w", err)
	}
	return hex.EncodeToString(b), nil
}
