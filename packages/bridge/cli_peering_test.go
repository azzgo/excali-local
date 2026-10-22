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

func TestAutostartOnAndOffAreNotImplemented(t *testing.T) {
	_, _ = withTempConfigAndHome(t)

	for _, sub := range []string{"on", "off"} {
		code := 0
		stderr := captureStderr(t, func() {
			code = run([]string{"autostart", sub})
		})
		if code != 2 {
			t.Fatalf("autostart %s exit = %d, want 2", sub, code)
		}
		if !strings.Contains(stderr, "not implemented") {
			t.Fatalf("autostart %s stderr %q must say it is not implemented", sub, stderr)
		}
		if !strings.Contains(stderr, "ADR 0012") {
			t.Fatalf("autostart %s stderr %q must point at ADR 0012 decision 2", sub, stderr)
		}
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
