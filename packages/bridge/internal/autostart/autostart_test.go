package autostart

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDetectMacLaunchAgent(t *testing.T) {
	home := t.TempDir()
	binary := filepath.Join(home, ".local", "bin", "excali-bridge")
	dir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	plist := `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.excali-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>` + binary + `</string>
    <string>serve</string>
  </array>
</dict>
</plist>
`
	if err := os.WriteFile(filepath.Join(dir, "local.excali-bridge.plist"), []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}

	status, err := Detect(Options{GOOS: "darwin", Home: home, Binaries: []string{binary}})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled {
		t.Fatal("the launch agent must be detected")
	}
	want := filepath.Join(dir, "local.excali-bridge.plist")
	if len(status.Entries) != 1 || status.Entries[0] != want {
		t.Fatalf("entries = %v, want [%s]", status.Entries, want)
	}
}

func TestDetectMacIgnoresOtherBinaries(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/other-daemon</string>
  </array>
</dict>
</plist>
`
	if err := os.WriteFile(filepath.Join(dir, "other.plist"), []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}

	status, err := Detect(Options{
		GOOS:     "darwin",
		Home:     home,
		Binaries: []string{filepath.Join(home, ".local", "bin", "excali-bridge")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if status.Enabled {
		t.Fatalf("a launch agent for another binary must not count: %v", status.Entries)
	}
}

func TestDetectMacNoLaunchAgentsDir(t *testing.T) {
	home := t.TempDir()
	status, err := Detect(Options{GOOS: "darwin", Home: home, Binaries: []string{"/opt/bin/excali-bridge"}})
	if err != nil {
		t.Fatal(err)
	}
	if status.Enabled {
		t.Fatal("no launch agents dir means autostart is disabled")
	}
	if status.Entries == nil {
		t.Fatal("entries must be an empty list, never nil")
	}
}

func TestDetectLinuxDesktopEntry(t *testing.T) {
	home := t.TempDir()
	binary := filepath.Join(home, ".local", "bin", "excali-bridge")
	dir := filepath.Join(home, ".config", "autostart")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	desktop := "[Desktop Entry]\nType=Application\nName=Excali Bridge\nExec=" + binary + " serve\n"
	if err := os.WriteFile(filepath.Join(dir, "excali-bridge.desktop"), []byte(desktop), 0o644); err != nil {
		t.Fatal(err)
	}

	status, err := Detect(Options{GOOS: "linux", Home: home, Binaries: []string{binary}})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled {
		t.Fatal("the desktop entry must be detected")
	}
	want := filepath.Join(dir, "excali-bridge.desktop")
	if len(status.Entries) != 1 || status.Entries[0] != want {
		t.Fatalf("entries = %v, want [%s]", status.Entries, want)
	}
}

func TestDetectLinuxUsesXDGConfigHome(t *testing.T) {
	home := t.TempDir()
	xdg := t.TempDir()
	binary := filepath.Join(home, ".local", "bin", "excali-bridge")
	dir := filepath.Join(xdg, "autostart")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	desktop := "[Desktop Entry]\nType=Application\nExec=\"" + binary + "\" serve\n"
	if err := os.WriteFile(filepath.Join(dir, "excali.desktop"), []byte(desktop), 0o644); err != nil {
		t.Fatal(err)
	}

	status, err := Detect(Options{GOOS: "linux", Home: home, XDGConfigHome: xdg, Binaries: []string{binary}})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled {
		t.Fatalf("the desktop entry under XDG_CONFIG_HOME must be detected: %v", status.Entries)
	}
}

func TestDetectLinuxIgnoresOtherBinaries(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".config", "autostart")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	desktop := "[Desktop Entry]\nType=Application\nExec=/usr/bin/somebody-else\n"
	if err := os.WriteFile(filepath.Join(dir, "other.desktop"), []byte(desktop), 0o644); err != nil {
		t.Fatal(err)
	}

	status, err := Detect(Options{GOOS: "linux", Home: home, Binaries: []string{"/opt/bin/excali-bridge"}})
	if err != nil {
		t.Fatal(err)
	}
	if status.Enabled {
		t.Fatalf("another program's desktop entry must not count: %v", status.Entries)
	}
}

func TestDetectWindowsRunKey(t *testing.T) {
	binary := `C:\Users\dev\.local\bin\excali-bridge.exe`
	values := []RegistryValue{
		{Name: "ExcaliBridge", Value: `"C:\Users\dev\.local\bin\excali-bridge.exe" serve`},
		{Name: "Other", Value: `C:\Windows\System32\notepad.exe`},
	}

	status, err := Detect(Options{
		GOOS:     "windows",
		Binaries: []string{binary},
		RegistryValues: func() ([]RegistryValue, error) {
			return values, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled {
		t.Fatal("the run key value must be detected")
	}
	want := RunKeyPath + `\ExcaliBridge`
	if len(status.Entries) != 1 || status.Entries[0] != want {
		t.Fatalf("entries = %v, want [%s]", status.Entries, want)
	}
}

func TestDetectWindowsRunKeyEmpty(t *testing.T) {
	status, err := Detect(Options{
		GOOS:     "windows",
		Binaries: []string{`C:\Users\dev\.local\bin\excali-bridge.exe`},
		RegistryValues: func() ([]RegistryValue, error) {
			return nil, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if status.Enabled {
		t.Fatal("an empty run key means autostart is disabled")
	}
}

func TestParseRegQuery(t *testing.T) {
	out := `
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
    ExcaliBridge    REG_SZ    C:\Users\dev\.local\bin\excali-bridge.exe serve
    Other    REG_SZ    C:\other\thing.exe
`
	values := parseRegQuery(out)
	if len(values) != 2 {
		t.Fatalf("values = %v, want 2", values)
	}
	if values[0].Name != "ExcaliBridge" {
		t.Fatalf("first name = %q, want ExcaliBridge", values[0].Name)
	}
	if !strings.Contains(values[0].Value, "excali-bridge.exe") {
		t.Fatalf("first value = %q", values[0].Value)
	}
}

func TestDetectUnsupportedPlatform(t *testing.T) {
	if _, err := Detect(Options{GOOS: "plan9"}); err == nil {
		t.Fatal("an unsupported platform must report an error")
	}
}
