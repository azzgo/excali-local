// Package autostart detects the operating system's login items that start the
// Bridge daemon. It detects only: ADR 0012 decision 2 makes the daemon the
// owner of the login item, and the write side (autostart on|off) is still
// undecided, so nothing here creates or removes an entry.
package autostart

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

// RunKeyPath is the Windows per-user Run key a login item lives in.
const RunKeyPath = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

// RegistryValue is one value of the Windows Run key.
type RegistryValue struct {
	Name  string
	Value string
}

// Options selects what Detect inspects. The zero value detects the current
// platform, the current user's home directory and the running binary.
type Options struct {
	GOOS          string
	Home          string
	XDGConfigHome string
	Binaries      []string
	// RegistryValues reads the Windows Run key. Defaults to the `reg` command;
	// tests inject their own lister.
	RegistryValues func() ([]RegistryValue, error)
}

// Status is the outcome of a detection pass.
type Status struct {
	Enabled bool
	Entries []string
}

// Detect reports the login items of the requested platform that start one of
// the given binaries.
func Detect(o Options) (Status, error) {
	o = o.withDefaults()

	var (
		entries []string
		err     error
	)
	switch o.GOOS {
	case "darwin":
		entries, err = launchAgentEntries(o.Home, o.Binaries)
	case "linux":
		entries, err = desktopEntries(o.Home, o.XDGConfigHome, o.Binaries)
	case "windows":
		entries, err = runKeyEntries(o.Binaries, o.RegistryValues)
	default:
		return Status{}, fmt.Errorf("autostart detection is not supported on %s", o.GOOS)
	}
	if err != nil {
		return Status{}, err
	}
	if entries == nil {
		entries = []string{}
	}
	return Status{Enabled: len(entries) > 0, Entries: entries}, nil
}

func (o Options) withDefaults() Options {
	if o.GOOS == "" {
		o.GOOS = runtime.GOOS
	}
	if o.Home == "" {
		if home, err := os.UserHomeDir(); err == nil {
			o.Home = home
		}
	}
	if len(o.Binaries) == 0 {
		o.Binaries = CandidateBinaries()
	}
	return o
}

// CandidateBinaries returns the paths a login item may point at: the running
// binary, the EXCALI_BRIDGE_BIN development override, and the canonical
// install path (ADR 0012 decision 4).
func CandidateBinaries() []string {
	var out []string
	add := func(p string) {
		if p == "" {
			return
		}
		for _, existing := range out {
			if existing == p {
				return
			}
		}
		out = append(out, p)
	}
	if bin, err := os.Executable(); err == nil {
		add(bin)
	}
	add(os.Getenv("EXCALI_BRIDGE_BIN"))
	add(CanonicalBinaryPath())
	return out
}

// CanonicalBinaryPath is the one install location a machine may have
// (ADR 0012 decision 4).
func CanonicalBinaryPath() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return ""
			}
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "ExcaliLocal", "bin", "excali-bridge.exe")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "bin", "excali-bridge")
}

func launchAgentEntries(home string, binaries []string) ([]string, error) {
	dir := filepath.Join(home, "Library", "LaunchAgents")
	items, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	m := matcher{binaries: binaries}
	var entries []string
	for _, item := range items {
		if item.IsDir() || !strings.EqualFold(filepath.Ext(item.Name()), ".plist") {
			continue
		}
		file := filepath.Join(dir, item.Name())
		if launchAgentPointsAt(file, m) {
			entries = append(entries, file)
		}
	}
	return entries, nil
}

type launchAgentPlist struct {
	XMLName xml.Name `xml:"plist"`
	Dict    struct {
		ProgramArguments struct {
			Items []string `xml:"string"`
		} `xml:"array"`
	} `xml:"dict"`
}

func launchAgentPointsAt(file string, m matcher) bool {
	data, err := os.ReadFile(file)
	if err != nil {
		return false
	}
	var plist launchAgentPlist
	if err := xml.Unmarshal(data, &plist); err == nil {
		if m.matchesAny(plist.Dict.ProgramArguments.Items) {
			return true
		}
	}
	return m.mentionsBinary(data)
}

func desktopEntries(home, xdgConfigHome string, binaries []string) ([]string, error) {
	base := xdgConfigHome
	if base == "" {
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, "autostart")
	items, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	m := matcher{binaries: binaries}
	var entries []string
	for _, item := range items {
		if item.IsDir() || !strings.EqualFold(filepath.Ext(item.Name()), ".desktop") {
			continue
		}
		file := filepath.Join(dir, item.Name())
		if desktopPointsAt(file, m) {
			entries = append(entries, file)
		}
	}
	return entries, nil
}

func desktopPointsAt(file string, m matcher) bool {
	data, err := os.ReadFile(file)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || key != "Exec" {
			continue
		}
		if m.matchesCommand(value) {
			return true
		}
	}
	return false
}

func runKeyEntries(binaries []string, lister func() ([]RegistryValue, error)) ([]string, error) {
	if lister == nil {
		lister = queryRunKey
	}
	values, err := lister()
	if err != nil {
		return nil, err
	}
	m := matcher{binaries: binaries, fold: true}
	var entries []string
	for _, value := range values {
		if m.matchesCommand(value.Value) {
			entries = append(entries, RunKeyPath+`\`+value.Name)
		}
	}
	return entries, nil
}

func queryRunKey() ([]RegistryValue, error) {
	if runtime.GOOS != "windows" {
		return nil, errors.New("the windows registry is only readable on windows")
	}
	out, err := exec.Command("reg", "query", RunKeyPath).Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && strings.Contains(strings.ToLower(string(exitErr.Stderr)), "unable to find") {
			return nil, nil
		}
		return nil, fmt.Errorf("reg query %s: %w", RunKeyPath, err)
	}
	return parseRegQuery(string(out)), nil
}

func parseRegQuery(out string) []RegistryValue {
	var values []RegistryValue
	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "HKEY_") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) < 3 {
			continue
		}
		values = append(values, RegistryValue{
			Name:  fields[0],
			Value: strings.Join(fields[2:], " "),
		})
	}
	return values
}

type matcher struct {
	binaries []string
	fold     bool
}

func (m matcher) matches(candidate string) bool {
	for _, binary := range m.binaries {
		if m.matchesBinary(candidate, binary) {
			return true
		}
	}
	return false
}

func (m matcher) matchesBinary(candidate, binary string) bool {
	if binary == "" {
		return false
	}
	a := normalizePath(candidate)
	b := normalizePath(binary)
	if a == "" || b == "" {
		return false
	}
	if m.equal(a, b) {
		return true
	}
	resolvedA, errA := filepath.EvalSymlinks(candidate)
	resolvedB, errB := filepath.EvalSymlinks(binary)
	if errA != nil || errB != nil {
		return false
	}
	return m.equal(normalizePath(resolvedA), normalizePath(resolvedB))
}

func (m matcher) equal(a, b string) bool {
	if m.fold {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func (m matcher) matchesAny(candidates []string) bool {
	for _, candidate := range candidates {
		if m.matches(candidate) {
			return true
		}
	}
	return false
}

func (m matcher) matchesCommand(command string) bool {
	return m.matchesAny(commandTokens(command))
}

func (m matcher) mentionsBinary(data []byte) bool {
	for _, binary := range m.binaries {
		if binary == "" {
			continue
		}
		if bytes.Contains(data, []byte(binary)) {
			return true
		}
	}
	return false
}

func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.Trim(p, `"'`)
	p = strings.ReplaceAll(p, `\`, "/")
	if p == "" {
		return ""
	}
	return path.Clean(p)
}

func commandTokens(command string) []string {
	var tokens []string
	var current strings.Builder
	quoted := false
	for _, r := range command {
		switch {
		case r == '"':
			quoted = !quoted
		case (r == ' ' || r == '\t') && !quoted:
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}
