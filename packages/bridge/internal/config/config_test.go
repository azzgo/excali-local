package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func withTempConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("EXCALI_BRIDGE_CONFIG_DIR", dir)
	return dir
}

func withTempHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func TestLoadDefaults(t *testing.T) {
	withTempConfigDir(t)
	withTempHome(t)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.LAN != LANUnset {
		t.Fatalf("LAN = %q, want %q", c.LAN, LANUnset)
	}
	if c.LANEnabled() {
		t.Fatal("a never-decided switch must keep the LAN listener closed")
	}

	host, _ := os.Hostname()
	if c.Alias != host {
		t.Fatalf("Alias = %q, want the hostname %q", c.Alias, host)
	}
}

func TestLoadMintsFingerprintOnce(t *testing.T) {
	dir := withTempConfigDir(t)
	withTempHome(t)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(c.Fingerprint) != 32 {
		t.Fatalf("fingerprint = %q, want 32 hex chars", c.Fingerprint)
	}
	for _, r := range c.Fingerprint {
		if !strings.ContainsRune("0123456789abcdef", r) {
			t.Fatalf("fingerprint = %q, want lowercase hex", c.Fingerprint)
		}
	}

	again, err := Load()
	if err != nil {
		t.Fatalf("second Load: %v", err)
	}
	if again.Fingerprint != c.Fingerprint {
		t.Fatalf("fingerprint changed: %q then %q", c.Fingerprint, again.Fingerprint)
	}

	persisted, err := EnsureFingerprint()
	if err != nil {
		t.Fatalf("EnsureFingerprint: %v", err)
	}
	if persisted != c.Fingerprint {
		t.Fatalf("EnsureFingerprint = %q, want %q", persisted, c.Fingerprint)
	}

	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatalf("fingerprint must be persisted: %v", err)
	}
}

func TestSetLANPersists(t *testing.T) {
	withTempConfigDir(t)
	withTempHome(t)

	if err := SetLAN(LANOn); err != nil {
		t.Fatalf("SetLAN(on): %v", err)
	}
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.LAN != LANOn || !c.LANEnabled() {
		t.Fatalf("LAN = %q, want on", c.LAN)
	}

	if err := SetLAN(LANOff); err != nil {
		t.Fatalf("SetLAN(off): %v", err)
	}
	c, err = Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.LAN != LANOff || c.LANEnabled() {
		t.Fatalf("LAN = %q, want off", c.LAN)
	}
}

func TestSetAliasPersists(t *testing.T) {
	withTempConfigDir(t)
	withTempHome(t)

	if err := SetAlias("studio-mac"); err != nil {
		t.Fatalf("SetAlias: %v", err)
	}
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Alias != "studio-mac" {
		t.Fatalf("Alias = %q, want studio-mac", c.Alias)
	}

	if err := SetAlias(""); err != nil {
		t.Fatalf("SetAlias(empty): %v", err)
	}
	c, err = Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	host, _ := os.Hostname()
	if c.Alias != host {
		t.Fatalf("Alias = %q, want the hostname %q", c.Alias, host)
	}
}

func TestFileShapeHasNoSecrets(t *testing.T) {
	dir := withTempConfigDir(t)
	withTempHome(t)

	if err := SetLAN(LANOn); err != nil {
		t.Fatalf("SetLAN: %v", err)
	}
	if err := SetAlias("studio-mac"); err != nil {
		t.Fatalf("SetAlias: %v", err)
	}
	if _, err := Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("config file is not valid JSON: %v", err)
	}

	want := map[string]bool{"lan": true, "alias": true, "fingerprint": true}
	for key := range raw {
		if !want[key] {
			t.Fatalf("unexpected key %q in config file", key)
		}
		delete(want, key)
	}
	if len(want) != 0 {
		t.Fatalf("missing keys in config file: %v", want)
	}
}

func TestLoadMigratesLegacyConfig(t *testing.T) {
	dir := withTempConfigDir(t)
	home := withTempHome(t)

	legacy := filepath.Join(home, ".excali-local")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyBody := `{"lan":"on","alias":"legacy-mac","fingerprint":"abcdef0123456789abcdef0123456789"}`
	if err := os.WriteFile(filepath.Join(legacy, FileName), []byte(legacyBody), 0o644); err != nil {
		t.Fatal(err)
	}

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.LAN != LANOn {
		t.Fatalf("LAN = %q, want the migrated on", c.LAN)
	}
	if c.Alias != "legacy-mac" {
		t.Fatalf("Alias = %q, want the migrated alias", c.Alias)
	}
	if c.Fingerprint != "abcdef0123456789abcdef0123456789" {
		t.Fatalf("Fingerprint = %q, want the migrated fingerprint", c.Fingerprint)
	}

	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatalf("legacy config was not relocated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(legacy, FileName)); err != nil {
		t.Fatalf("legacy config must stay as a tombstone: %v", err)
	}
}

func TestConcurrentReadWrite(t *testing.T) {
	dir := withTempConfigDir(t)
	withTempHome(t)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				if err := SetLAN(LANOn); err != nil {
					t.Errorf("SetLAN: %v", err)
					return
				}
				if err := SetAlias("peer"); err != nil {
					t.Errorf("SetAlias: %v", err)
					return
				}
				if _, err := Load(); err != nil {
					t.Errorf("Load: %v", err)
					return
				}
			}
		}(i)
	}
	wg.Wait()

	data, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("config file is not valid JSON after concurrent writes: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != FileName {
			t.Fatalf("leftover file %q in the config dir", e.Name())
		}
	}
}
