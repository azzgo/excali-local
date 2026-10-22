package pidfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteReadRemove(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.pid")

	if err := WriteAt(path, 1234, 17331); err != nil {
		t.Fatalf("WriteAt: %v", err)
	}
	info, err := ReadAt(path)
	if err != nil {
		t.Fatalf("ReadAt: %v", err)
	}
	if info.PID != 1234 || info.Port != 17331 {
		t.Fatalf("got %+v, want pid=1234 port=17331", info)
	}

	RemoveAt(path)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("pidfile still exists after RemoveAt")
	}
}

func TestReadMalformed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.pid")
	if err := os.WriteFile(path, []byte("not-json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadAt(path); err == nil {
		t.Fatal("expected error for malformed pidfile")
	}
}

func TestReadMissing(t *testing.T) {
	if _, err := ReadAt(filepath.Join(t.TempDir(), "nope.pid")); err == nil {
		t.Fatal("expected error for missing pidfile")
	}
}

func TestPathUsesStateDir(t *testing.T) {
	state := t.TempDir()
	t.Setenv("EXCALI_BRIDGE_STATE_DIR", state)
	t.Setenv("EXCALI_BRIDGE_PIDFILE", "")

	path, err := Path()
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	want := filepath.Join(state, "bridge.pid")
	if path != want {
		t.Fatalf("Path = %q, want %q", path, want)
	}
}

func TestPathEnvOverrideWins(t *testing.T) {
	t.Setenv("EXCALI_BRIDGE_STATE_DIR", t.TempDir())
	override := filepath.Join(t.TempDir(), "custom.pid")
	t.Setenv("EXCALI_BRIDGE_PIDFILE", override)

	path, err := Path()
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if path != override {
		t.Fatalf("Path = %q, want %q", path, override)
	}
}

func TestReadMigratesLegacyPidfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	state := t.TempDir()
	t.Setenv("EXCALI_BRIDGE_STATE_DIR", state)
	t.Setenv("EXCALI_BRIDGE_PIDFILE", "")

	legacy := filepath.Join(home, ".excali-local")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteAt(filepath.Join(legacy, "bridge.pid"), 4321, 17333); err != nil {
		t.Fatal(err)
	}

	info, err := Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.PID != 4321 || info.Port != 17333 {
		t.Fatalf("got %+v, want pid=4321 port=17333", info)
	}

	if _, err := os.Stat(filepath.Join(state, "bridge.pid")); err != nil {
		t.Fatalf("pidfile was not relocated to the state dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(legacy, "bridge.pid")); err != nil {
		t.Fatalf("legacy pidfile must stay as a tombstone: %v", err)
	}
}

func TestReadPrefersStateDirOverLegacy(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	state := t.TempDir()
	t.Setenv("EXCALI_BRIDGE_STATE_DIR", state)
	t.Setenv("EXCALI_BRIDGE_PIDFILE", "")

	legacy := filepath.Join(home, ".excali-local")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteAt(filepath.Join(legacy, "bridge.pid"), 1111, 17331); err != nil {
		t.Fatal(err)
	}
	if err := WriteAt(filepath.Join(state, "bridge.pid"), 2222, 17332); err != nil {
		t.Fatal(err)
	}

	info, err := Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.PID != 2222 {
		t.Fatalf("pid = %d, want the state-dir pidfile 2222", info.PID)
	}
}

func TestAlive(t *testing.T) {
	if !Alive(os.Getpid()) {
		t.Fatal("own pid should be alive")
	}
	if Alive(999999999) {
		t.Fatal("bogus pid should not be alive")
	}
}
