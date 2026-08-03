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

func TestAlive(t *testing.T) {
	if !Alive(os.Getpid()) {
		t.Fatal("own pid should be alive")
	}
	if Alive(999999999) {
		t.Fatal("bogus pid should not be alive")
	}
}
