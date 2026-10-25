package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withTempConfigAndHome(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("EXCALI_BRIDGE_CONFIG_DIR", dir)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return dir, home
}

func TestLANOnOffRoundTripsThroughConfig(t *testing.T) {
	dir, _ := withTempConfigAndHome(t)

	if code := run([]string{"lan", "on"}); code != 0 {
		t.Fatalf("lan on exit = %d, want 0", code)
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored struct {
		LAN string `json:"lan"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("config file is not valid JSON: %v", err)
	}
	if stored.LAN != "on" {
		t.Fatalf("persisted lan = %q, want on", stored.LAN)
	}

	if code := run([]string{"lan", "off"}); code != 0 {
		t.Fatalf("lan off exit = %d, want 0", code)
	}
	data, err = os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("config file is not valid JSON: %v", err)
	}
	if stored.LAN != "off" {
		t.Fatalf("persisted lan = %q, want off", stored.LAN)
	}
}

func TestLANStatusWorksWithoutDaemon(t *testing.T) {
	dir, _ := withTempConfigAndHome(t)
	t.Setenv("EXCALI_BRIDGE_PIDFILE", filepath.Join(t.TempDir(), "bridge.pid"))

	if code := run([]string{"lan", "status"}); code != 0 {
		t.Fatalf("lan status exit = %d, want 0", code)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.json")); err != nil {
		t.Fatalf("lan status must not need a config file: %v", err)
	}
}

func TestLANStatusJSONShape(t *testing.T) {
	dir, _ := withTempConfigAndHome(t)
	t.Setenv("EXCALI_BRIDGE_PIDFILE", filepath.Join(t.TempDir(), "bridge.pid"))

	if code := run([]string{"lan", "on"}); code != 0 {
		t.Fatalf("lan on exit = %d, want 0", code)
	}

	out := captureStdout(t, func() {
		if code := run([]string{"lan", "status", "--json"}); code != 0 {
			t.Fatalf("lan status --json exit = %d, want 0", code)
		}
	})

	var report struct {
		LAN   string `json:"lan"`
		Port  int    `json:"port"`
		Peers int    `json:"peers"`
	}
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		t.Fatalf("lan status --json is not valid JSON (%q): %v", out, err)
	}
	if report.LAN != "on" {
		t.Fatalf("lan = %q, want on", report.LAN)
	}
	if report.Port != 0 {
		t.Fatalf("port = %d, want 0 (no daemon running)", report.Port)
	}
	if report.Peers != 0 {
		t.Fatalf("peers = %d, want 0 (no daemon running)", report.Peers)
	}
	_ = dir
}

func TestPeersWithoutDaemonReportsClearly(t *testing.T) {
	_, _ = withTempConfigAndHome(t)
	t.Setenv("EXCALI_BRIDGE_PIDFILE", filepath.Join(t.TempDir(), "bridge.pid"))

	code := 0
	stderr := captureStderr(t, func() {
		code = run([]string{"peers"})
	})
	if code != 1 {
		t.Fatalf("peers exit = %d, want 1", code)
	}
	if !strings.Contains(stderr, "peers") {
		t.Fatalf("stderr %q must name the failing command", stderr)
	}
	if !strings.Contains(stderr, "daemon") {
		t.Fatalf("stderr %q must say the daemon is not running", stderr)
	}
}

func TestAutostartStatusReportsDisabledWithNoEntries(t *testing.T) {
	_, home := withTempConfigAndHome(t)
	t.Setenv("EXCALI_BRIDGE_BIN", filepath.Join(home, "bin", "excali-bridge"))

	out := captureStdout(t, func() {
		if code := run([]string{"autostart", "status", "--json"}); code != 0 {
			t.Fatalf("autostart status exit = %d, want 0", code)
		}
	})

	var report struct {
		Enabled bool     `json:"enabled"`
		Entries []string `json:"entries"`
	}
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		t.Fatalf("autostart status --json is not valid JSON (%q): %v", out, err)
	}
	if report.Enabled {
		t.Fatalf("autostart must be disabled with no login item, got %v", report)
	}
	if len(report.Entries) != 0 {
		t.Fatalf("entries = %v, want none", report.Entries)
	}
}

func TestAutostartOnAndOffRoundTrip(t *testing.T) {
	_, home := withTempConfigAndHome(t)
	binary := filepath.Join(home, "bin", "excali-bridge")
	t.Setenv("EXCALI_BRIDGE_BIN", binary)

	// on: creates the login item and reports it enabled.
	out := captureStdout(t, func() {
		if code := run([]string{"autostart", "on", "--json"}); code != 0 {
			t.Fatalf("autostart on exit != 0")
		}
	})
	var on struct {
		Enabled bool     `json:"enabled"`
		Entries []string `json:"entries"`
	}
	if err := json.Unmarshal([]byte(out), &on); err != nil {
		t.Fatalf("autostart on --json is not valid JSON (%q): %v", out, err)
	}
	if !on.Enabled || len(on.Entries) == 0 {
		t.Fatalf("autostart on must report an enabled login item, got %v", on)
	}
	if _, err := os.Stat(on.Entries[0]); err != nil {
		t.Fatalf("the login item %s must exist on disk: %v", on.Entries[0], err)
	}

	// off: removes it again.
	out = captureStdout(t, func() {
		if code := run([]string{"autostart", "off", "--json"}); code != 0 {
			t.Fatalf("autostart off exit != 0")
		}
	})
	var off struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal([]byte(out), &off); err != nil {
		t.Fatalf("autostart off --json is not valid JSON (%q): %v", out, err)
	}
	if off.Enabled {
		t.Fatalf("autostart off must report a disabled login item, got %v", off)
	}
	if _, err := os.Stat(on.Entries[0]); !os.IsNotExist(err) {
		t.Fatalf("the login item %s must be gone, stat err = %v", on.Entries[0], err)
	}

	// off again: idempotent, still exit 0.
	if code := run([]string{"autostart", "off"}); code != 0 {
		t.Fatalf("a second autostart off exit = %d, want 0", code)
	}
}

func TestUnknownSubcommandExitsTwo(t *testing.T) {
	_, _ = withTempConfigAndHome(t)

	captureStderr(t, func() {
		if code := run([]string{"lan", "sideways"}); code != 2 {
			t.Fatalf("lan sideways exit = %d, want 2", code)
		}
	})
	captureStderr(t, func() {
		if code := run([]string{"autostart", "sideways"}); code != 2 {
			t.Fatalf("autostart sideways exit = %d, want 2", code)
		}
	})
}
