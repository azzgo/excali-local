package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/excali-local/excali-bridge/internal/autostart"
	"github.com/excali-local/excali-bridge/internal/client"
	"github.com/excali-local/excali-bridge/internal/config"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"os"
	"runtime"
	"time"
)

type lanStatusReport struct {
	LAN   string `json:"lan"`
	Port  int    `json:"port"`
	Peers int    `json:"peers"`
}

// peersProbeTimeout bounds one peers.list round-trip.
const peersProbeTimeout = 5 * time.Second

type autostartStatusReport struct {
	Enabled bool     `json:"enabled"`
	Entries []string `json:"entries"`
}

func cmdLAN(args []string) int {
	if len(args) == 0 {
		return cmdLANStatus(nil)
	}
	switch args[0] {
	case "status":
		return cmdLANStatus(args[1:])
	case "on":
		return cmdLANSet(config.LANOn, args[1:])
	case "off":
		return cmdLANSet(config.LANOff, args[1:])
	}
	fmt.Fprintf(os.Stderr, "excali-bridge lan: unknown subcommand %q (want status|on|off)\n", args[0])
	return 2
}

func cmdLANStatus(args []string) int {
	jsonOut := hasFlag(args, "--json")

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge lan status: %v\n", err)
		return 1
	}

	report := lanStatusReport{LAN: string(cfg.LAN)}

	if info, err := pidfile.Read(); err == nil && pidfile.Alive(info.PID) && healthOK(info.Port) {
		report.Port = info.Port
		if peers, err := callPeersList(peersProbeTimeout); err == nil {
			report.Peers = len(peers)
		}
	}

	if jsonOut {
		printJSON(report)
		return 0
	}

	fmt.Printf("LAN listener: %s\n", lanSwitchLabel(cfg.LAN))
	fmt.Printf("device alias: %s\n", cfg.Alias)
	fmt.Printf("config file: %s\n", configPathLabel())
	if report.Port > 0 {
		fmt.Printf("bridge daemon: running (port=%d)\n", report.Port)
	} else {
		fmt.Println("bridge daemon: not running")
	}
	fmt.Printf("peer devices: %d\n", report.Peers)
	if cfg.LAN == config.LANOn && report.Port == 0 {
		fmt.Println("the LAN listener opens on the next daemon start")
	}
	return 0
}

func cmdLANSet(lan config.LANSwitch, args []string) int {
	jsonOut := hasFlag(args, "--json")

	if err := config.SetLAN(lan); err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge lan %s: %v\n", lan, err)
		return 1
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge lan %s: %v\n", lan, err)
		return 1
	}

	report := lanStatusReport{LAN: string(cfg.LAN)}
	if info, err := pidfile.Read(); err == nil && pidfile.Alive(info.PID) && healthOK(info.Port) {
		report.Port = info.Port
	}

	if jsonOut {
		printJSON(report)
		return 0
	}

	fmt.Printf("LAN listener: %s (persisted)\n", lanSwitchLabel(cfg.LAN))
	fmt.Printf("config file: %s\n", configPathLabel())
	if report.Port == 0 {
		fmt.Println("the bridge daemon is not running — the switch takes effect on the next start")
	} else {
		fmt.Println("the bridge daemon is running — restart it to apply the switch")
	}
	return 0
}

func cmdPeers(args []string) int {
	jsonOut := hasFlag(args, "--json")

	peers, err := callPeersList(peersProbeTimeout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge peers: %v\n", err)
		switch {
		case errors.Is(err, client.ErrDaemonNotRunning):
			fmt.Fprintln(os.Stderr, "start it with `excali-bridge serve`, or let any other command spawn it lazily")
		case errors.Is(err, context.DeadlineExceeded):
			fmt.Fprintln(os.Stderr, "the daemon did not answer in time")
		}
		return 1
	}

	if jsonOut {
		printJSON(peers)
		return 0
	}
	if len(peers) == 0 {
		fmt.Println("no peer devices discovered")
		return 0
	}
	for _, peer := range peers {
		fmt.Println(peerLine(peer))
	}
	return 0
}

func cmdAutostart(args []string) int {
	if len(args) == 0 {
		return cmdAutostartStatus(nil)
	}
	switch args[0] {
	case "status":
		return cmdAutostartStatus(args[1:])
	case "on", "off":
		fmt.Fprintf(os.Stderr,
			"excali-bridge autostart %s: not implemented — the daemon owns the login item (ADR 0012 decision 2); the write side is still undecided\n",
			args[0])
		return 2
	}
	fmt.Fprintf(os.Stderr, "excali-bridge autostart: unknown subcommand %q (want status|on|off)\n", args[0])
	return 2
}

func cmdAutostartStatus(args []string) int {
	jsonOut := hasFlag(args, "--json")

	status, err := autostart.Detect(autostart.Options{
		GOOS:     runtime.GOOS,
		Home:     os.Getenv("HOME"),
		Binaries: autostart.CandidateBinaries(),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge autostart status: %v\n", err)
		return 1
	}

	if jsonOut {
		printJSON(autostartStatusReport{Enabled: status.Enabled, Entries: status.Entries})
		return 0
	}

	if status.Enabled {
		fmt.Println("autostart: enabled")
		for _, entry := range status.Entries {
			fmt.Printf("  %s\n", entry)
		}
		return 0
	}
	fmt.Println("autostart: disabled")
	return 0
}

func callPeersList(timeout time.Duration) ([]map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	result, err := client.Call(ctx, client.Options{NoSpawn: true, Timeout: timeout}, "peers.list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var peers []map[string]any
	if err := json.Unmarshal(result, &peers); err != nil {
		return nil, fmt.Errorf("malformed peers.list result: %w", err)
	}
	return peers, nil
}

func peerLine(peer map[string]any) string {
	alias, _ := peer["alias"].(string)
	address, _ := peer["address"].(string)
	port := peer["port"]
	if alias == "" {
		alias = "(unnamed peer)"
	}
	if address == "" {
		return fmt.Sprintf("%s (address unknown)", alias)
	}
	return fmt.Sprintf("%s  %s:%v", alias, address, port)
}

func lanSwitchLabel(lan config.LANSwitch) string {
	switch lan {
	case config.LANOn:
		return "on"
	case config.LANOff:
		return "off"
	default:
		return "unset (off — the LAN listener stays closed until you turn it on)"
	}
}

func configPathLabel() string {
	path, err := config.Path()
	if err != nil {
		return "(unknown)"
	}
	return path
}

func hasFlag(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
	}
	return false
}

func printJSON(v any) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge: %v\n", err)
		return
	}
	fmt.Println(string(data))
}
