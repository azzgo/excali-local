package paths

import (
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

func TestStateDirPlatformLayout(t *testing.T) {
	home := filepath.Join("/home", "tester")

	cases := []struct {
		goos         string
		xdgStateHome string
		localAppData string
		want         string
	}{
		{
			goos:         "linux",
			xdgStateHome: "/xdg/state",
			want:         filepath.Join("/xdg/state", AppDir),
		},
		{
			goos: "linux",
			want: filepath.Join(home, ".local", "state", AppDir),
		},
		{
			goos: "darwin",
			want: filepath.Join(home, "Library", "Application Support", AppDir),
		},
		{
			goos:         "windows",
			localAppData: `C:\Users\tester\AppData\Local`,
			want:         filepath.Join(`C:\Users\tester\AppData\Local`, AppDir),
		},
	}

	for _, tc := range cases {
		got := stateDirFor(tc.goos, home, tc.xdgStateHome, tc.localAppData)
		if got != tc.want {
			t.Errorf("stateDirFor(%s) = %q, want %q", tc.goos, got, tc.want)
		}
	}
}

func TestConfigDirPlatformLayout(t *testing.T) {
	home := filepath.Join("/home", "tester")

	cases := []struct {
		goos          string
		xdgConfigHome string
		localAppData  string
		want          string
	}{
		{
			goos:          "linux",
			xdgConfigHome: "/xdg/config",
			want:          filepath.Join("/xdg/config", AppDir),
		},
		{
			goos: "linux",
			want: filepath.Join(home, ".config", AppDir),
		},
		{
			goos: "darwin",
			want: filepath.Join(home, "Library", "Application Support", AppDir),
		},
		{
			goos:         "windows",
			localAppData: `C:\Users\tester\AppData\Local`,
			want:         filepath.Join(`C:\Users\tester\AppData\Local`, AppDir),
		},
	}

	for _, tc := range cases {
		got := configDirFor(tc.goos, home, tc.xdgConfigHome, tc.localAppData)
		if got != tc.want {
			t.Errorf("configDirFor(%s) = %q, want %q", tc.goos, got, tc.want)
		}
	}
}

func TestStateDirUsesXDGStateHome(t *testing.T) {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		t.Skip("XDG_STATE_HOME only applies on the linux layout")
	}
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv(EnvStateDir, "")

	dir, err := StateDir()
	if err != nil {
		t.Fatalf("StateDir: %v", err)
	}
	want := filepath.Join(os.Getenv("XDG_STATE_HOME"), AppDir)
	if dir != want {
		t.Fatalf("StateDir = %q, want %q", dir, want)
	}
}

func TestEnvOverrides(t *testing.T) {
	state := t.TempDir()
	config := t.TempDir()
	t.Setenv(EnvStateDir, state)
	t.Setenv(EnvConfigDir, config)

	gotState, err := StateDir()
	if err != nil {
		t.Fatalf("StateDir: %v", err)
	}
	if gotState != state {
		t.Fatalf("StateDir = %q, want %q", gotState, state)
	}

	gotConfig, err := ConfigDir()
	if err != nil {
		t.Fatalf("ConfigDir: %v", err)
	}
	if gotConfig != config {
		t.Fatalf("ConfigDir = %q, want %q", gotConfig, config)
	}
}

func TestLegacyDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	dir, err := LegacyDir()
	if err != nil {
		t.Fatalf("LegacyDir: %v", err)
	}
	want := filepath.Join(home, LegacyAppDir)
	if dir != want {
		t.Fatalf("LegacyDir = %q, want %q", dir, want)
	}
}

func TestMigrateFileCopiesOnceAndKeepsTombstone(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	legacy := filepath.Join(home, LegacyAppDir)
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "bridge.pid"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}

	dstDir := filepath.Join(t.TempDir(), "state")

	migrated, err := MigrateFile("bridge.pid", dstDir)
	if err != nil {
		t.Fatalf("MigrateFile: %v", err)
	}
	if !migrated {
		t.Fatal("first migration should report a copy")
	}

	got, err := os.ReadFile(filepath.Join(dstDir, "bridge.pid"))
	if err != nil {
		t.Fatalf("read migrated file: %v", err)
	}
	if string(got) != "payload" {
		t.Fatalf("migrated content = %q, want %q", got, "payload")
	}

	if _, err := os.Stat(filepath.Join(legacy, "bridge.pid")); err != nil {
		t.Fatalf("legacy file must stay as a tombstone: %v", err)
	}

	migrated, err = MigrateFile("bridge.pid", dstDir)
	if err != nil {
		t.Fatalf("second MigrateFile: %v", err)
	}
	if migrated {
		t.Fatal("second migration must not copy again")
	}
}

func TestMigrateFileKeepsExistingTarget(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	legacy := filepath.Join(home, LegacyAppDir)
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}

	dstDir := filepath.Join(t.TempDir(), "config")
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dstDir, "config.json"), []byte("current"), 0o644); err != nil {
		t.Fatal(err)
	}

	migrated, err := MigrateFile("config.json", dstDir)
	if err != nil {
		t.Fatalf("MigrateFile: %v", err)
	}
	if migrated {
		t.Fatal("existing target must not be overwritten")
	}

	got, err := os.ReadFile(filepath.Join(dstDir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "current" {
		t.Fatalf("target content = %q, want %q", got, "current")
	}
}

func TestMigrateFileMissingLegacyIsNotAnError(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	migrated, err := MigrateFile("bridge.pid", filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatalf("MigrateFile: %v", err)
	}
	if migrated {
		t.Fatal("nothing to migrate")
	}
}

func TestMigrateFileIsConcurrencySafe(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	legacy := filepath.Join(home, LegacyAppDir)
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "bridge.pid"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}

	dstDir := filepath.Join(t.TempDir(), "state")

	var wg sync.WaitGroup
	copies := make(chan bool, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			migrated, err := MigrateFile("bridge.pid", dstDir)
			if err != nil {
				t.Errorf("MigrateFile: %v", err)
				return
			}
			copies <- migrated
		}()
	}
	wg.Wait()
	close(copies)

	count := 0
	for migrated := range copies {
		if migrated {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("copies = %d, want exactly 1", count)
	}

	entries, err := os.ReadDir(dstDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("state dir entries = %d, want 1 (no leftover temp files)", len(entries))
	}
}
