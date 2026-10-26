// Package autostart owns the operating system's login items that start the
// Bridge daemon: it detects an existing item and creates or removes the one
// the daemon manages (ADR 0012 decision 2 — the daemon owns the login item).
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

const (
	// RunKeyPath is the Windows per-user Run key a login item lives in.
	RunKeyPath = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	// RunValueName is the value name of the daemon's Windows login item.
	RunValueName = "ExcaliLocalBridge"
	// LaunchAgentLabel is the macOS launch-agent label and plist base name.
	LaunchAgentLabel = "com.excali-local.bridge"
	// DesktopEntryName is the XDG autostart desktop-entry file name.
	DesktopEntryName = "excali-local-bridge.desktop"
)

// RegistryValue is one value of the Windows Run key.
type RegistryValue struct {
	Name  string
	Value string
}

// Options selects what Detect inspects and what Enable/Disable writes. The zero
// value targets the current platform, the current user's home directory and the
// running binary.
type Options struct {
	GOOS          string
	Home          string
	XDGConfigHome string
	Binaries      []string
	// RegistryValues reads the Windows Run key. Defaults to the `reg` command;
	// tests inject their own lister.
	RegistryValues func() ([]RegistryValue, error)
	// Run executes a system command for the write side (the Windows Run key and
	// the macOS launchd registration). Defaults to running the command; tests
	// inject their own runner.
	Run func(name string, args ...string) error
	// UID is the login session's user id, used to address the launchd domain
	// (gui/<uid>) on macOS. Defaults to os.Getuid(); tests inject a fixed value.
	UID int
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
	if o.Run == nil {
		o.Run = runCommand
	}
	if o.UID == 0 {
		o.UID = os.Getuid()
	}
	return o
}

// Enable creates the login item that starts the daemon at login. It points at
// the running binary and is idempotent: a second call overwrites the same entry.
func Enable(o Options) error {
	o = o.withDefaults()
	binary, err := targetBinary(o)
	if err != nil {
		return err
	}
	switch o.GOOS {
	case "darwin":
		if err := writeLaunchAgent(o.Home, binary); err != nil {
			return err
		}
		return bootstrapLaunchAgent(o)
	case "linux":
		return writeDesktopEntry(o.Home, o.XDGConfigHome, binary)
	case "windows":
		return addRunValue(o.Run, binary)
	default:
		return fmt.Errorf("autostart is not supported on %s", o.GOOS)
	}
}

// Disable removes the login item the daemon owns. It is idempotent: removing an
// entry that does not exist succeeds.
func Disable(o Options) error {
	o = o.withDefaults()
	switch o.GOOS {
	case "darwin":
		bootoutLaunchAgent(o)
		return removeFile(launchAgentFile(o.Home))
	case "linux":
		return removeFile(desktopEntryFile(o.Home, o.XDGConfigHome))
	case "windows":
		return deleteRunValue(o.Run)
	default:
		return fmt.Errorf("autostart is not supported on %s", o.GOOS)
	}
}

func targetBinary(o Options) (string, error) {
	for _, binary := range o.Binaries {
		if strings.TrimSpace(binary) == "" {
			continue
		}
		if o.GOOS == "windows" {
			return binary, nil
		}
		abs, err := filepath.Abs(binary)
		if err != nil {
			return "", fmt.Errorf("resolve bridge binary %q: %w", binary, err)
		}
		return abs, nil
	}
	return "", errors.New("no bridge binary path to install as a login item")
}

func launchAgentFile(home string) string {
	return filepath.Join(home, "Library", "LaunchAgents", LaunchAgentLabel+".plist")
}

func writeLaunchAgent(home, binary string) error {
	file := launchAgentFile(home)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return fmt.Errorf("create launch agents dir: %w", err)
	}
	// `serve` explicitly rather than relying on the no-argument default: the
	// login item is read by anyone debugging it, and StandardErrorPath keeps the
	// daemon's own log lines out of launchd's bit bucket.
	logFile := filepath.Join(home, "Library", "Logs", "excali-bridge.log")
	if err := os.MkdirAll(filepath.Dir(logFile), 0o755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>` + LaunchAgentLabel + `</string>
  <key>ProgramArguments</key>
  <array>
    <string>` + xmlEscape(binary) + `</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>` + xmlEscape(logFile) + `</string>
</dict>
</plist>
`
	if err := os.WriteFile(file, []byte(plist), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	return nil
}

// bootstrapLaunchAgent loads the launch agent into the user's GUI session.
//
// Writing the plist alone is not enough: launchd does not notice a new file in
// ~/Library/LaunchAgents until the next login, so `autostart on` would look like
// it did nothing (no Login Items entry, no background item) for the rest of the
// session. `launchctl bootstrap` is the explicit load.
func bootstrapLaunchAgent(o Options) error {
	file := launchAgentFile(o.Home)
	if err := o.Run("launchctl", "bootstrap", launchdDomain(o.UID), file); err != nil {
		// Already loaded is a success for an idempotent enable: bootstrapping a
		// second time is a caller-visible no-op, not a failure.
		if strings.Contains(strings.ToLower(err.Error()), "already bootstrapped") ||
			strings.Contains(strings.ToLower(err.Error()), "service already loaded") {
			return nil
		}
		return fmt.Errorf("launchctl bootstrap %s: %w", file, err)
	}
	return nil
}

// bootoutLaunchAgent unloads the agent. Best effort: it runs before the plist is
// removed, and a service that was never loaded is not an error.
func bootoutLaunchAgent(o Options) {
	_ = o.Run("launchctl", "bootout", launchdDomain(o.UID)+"/"+LaunchAgentLabel)
}

func launchdDomain(uid int) string {
	return fmt.Sprintf("gui/%d", uid)
}

func desktopEntryFile(home, xdgConfigHome string) string {
	base := xdgConfigHome
	if base == "" {
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "autostart", DesktopEntryName)
}

func writeDesktopEntry(home, xdgConfigHome, binary string) error {
	file := desktopEntryFile(home, xdgConfigHome)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return fmt.Errorf("create autostart dir: %w", err)
	}
	desktop := "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=Excali Bridge\n" +
		"Comment=Start the Excali Local Agent Bridge daemon at login\n" +
		"Exec=\"" + binary + "\"\n" +
		"Terminal=false\n" +
		"X-GNOME-Autostart-enabled=true\n"
	if err := os.WriteFile(file, []byte(desktop), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	return nil
}

func addRunValue(run func(string, ...string) error, binary string) error {
	if err := run("reg", "add", RunKeyPath, "/v", RunValueName, "/t", "REG_SZ", "/d", quoteWindows(binary), "/f"); err != nil {
		return fmt.Errorf("reg add %s: %w", RunKeyPath, err)
	}
	return nil
}

func deleteRunValue(run func(string, ...string) error) error {
	if err := run("reg", "delete", RunKeyPath, "/v", RunValueName, "/f"); err != nil {
		if isMissingRegistryEntry(err) {
			return nil
		}
		return fmt.Errorf("reg delete %s: %w", RunKeyPath, err)
	}
	return nil
}

func runCommand(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w (%s)", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func isMissingRegistryEntry(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unable to find") || strings.Contains(message, "not found")
}

func quoteWindows(p string) string {
	if strings.HasPrefix(p, `"`) && strings.HasSuffix(p, `"`) {
		return p
	}
	return `"` + p + `"`
}

func xmlEscape(s string) string {
	var buf bytes.Buffer
	if err := xml.EscapeText(&buf, []byte(s)); err != nil {
		return s
	}
	return buf.String()
}

func removeFile(file string) error {
	if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove %s: %w", file, err)
	}
	return nil
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
