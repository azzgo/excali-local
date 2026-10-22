// Command excali-bridge is the Agent Bridge daemon (Wayfinder Ticket 009):
// ONE self-contained Go binary that is BOTH the WS server (Leg B — activated
// Local editor pages dial out to ws://127.0.0.1:[17331..17335]) AND the agent
// CLI (Leg A — versioned minimal JSON-RPC over the same server). It is the
// cross-profile single-active-canvas arbiter (Tickets 016/017): pidfile
// single-instance, ≤1 active page, new activation displaces.
//
//	excali-bridge serve    run the daemon (writes ~/.excali-local/bridge.pid;
//	                       lazily spawned by the CLI on first use)
//	excali-bridge ping     Leg-A JSON-RPC `ping` round-trip (subcommand ==
//	                       method); spawns the daemon if not running; exit 0
//	excali-bridge status   report whether the daemon is up
//	excali-bridge help     usage
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/excali-local/excali-bridge/internal/client"
	"github.com/excali-local/excali-bridge/internal/contract"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"github.com/excali-local/excali-bridge/internal/server"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		return cmdServe()
	}
	cmd := args[0]
	switch cmd {
	case "serve":
		return cmdServe()
	case "status":
		return cmdStatus()
	case "lan":
		return cmdLAN(args[1:])
	case "peers":
		return cmdPeers(args[1:])
	case "autostart":
		return cmdAutostart(args[1:])
	case "help", "--help", "-h":
		usage()
		return 0
	}
	// CLI subcommand == JSON-RPC method (canvas/v1 + gallery/v1 + fonts/v1 +
	// locals):
	//   excali-bridge scene.get
	//   excali-bridge scene.update '{"elements":[...]}'
	//   excali-bridge gallery.list
	//   excali-bridge fonts.system.list
	//   excali-bridge bridge.status
	if contract.IsCanvasV1Method(cmd) || contract.IsGalleryV1Method(cmd) ||
		contract.IsFontsV1Method(cmd) || contract.IsPeeringMethod(cmd) ||
		contract.DaemonLocalMethods[cmd] ||
		cmd == "ping" || cmd == contract.BridgeStatusMethod {
		var paramsJSON string
		if len(args) > 1 {
			paramsJSON = args[1]
		}
		return cmdCall(cmd, paramsJSON)
	}
	fmt.Fprintf(os.Stderr, "excali-bridge: unknown command %q\n", cmd)
	usage()
	return 2
}

func usage() {
	fmt.Fprintf(os.Stderr, `excali-bridge — Agent Bridge daemon (Leg B: WS server for the editor page; Leg A: agent CLI)

Usage:
  excali-bridge serve        run the daemon on 127.0.0.1:[17331..17335] (first free);
                             writes the pidfile; runs until SIGINT/SIGTERM
  excali-bridge <method>     JSON-RPC call (subcommand == method); spawns the daemon lazily:
                             ping | bridge.status | commands.list | protocol.version |
                             scene.get | scene.elements | scene.state | scene.bounds |
                             scene.exportPng | scene.exportSvg | scene.update | elements.add |
                             elements.clear | scene.reset | files.add | tool.setActive |
                             view.scrollTo | history.clear |
                             gallery.list | gallery.get | gallery.load | gallery.save |
                             gallery.rename | gallery.delete | gallery.collections.list |
                             gallery.collections.create | gallery.collections.rename |
                             gallery.collections.delete |
                             fonts.get | fonts.system.list | fonts.assign | fonts.install |
                             fonts.clear
                             args = optional params JSON (e.g. '{"elements":[...]}')
  excali-bridge status       report daemon status from pidfile + /health
  excali-bridge lan status   report the LAN listener switch (the single source of truth);
  excali-bridge lan on      persist "LAN listener open" (takes effect on the next daemon start);
  excali-bridge lan off     persist "LAN listener closed"
  excali-bridge peers        list the discovered peer devices (needs a running daemon);
  excali-bridge autostart status
                             report the OS login item that starts the daemon
                             (autostart on|off: not implemented yet — see ADR 0012 decision 2)
  excali-bridge help         this help
                             add --json to lan status | lan on | lan off | peers | autostart status

Env:
  EXCALI_BRIDGE_PIDFILE   override the pidfile path
  EXCALI_BRIDGE_ORIGIN    strict origin allow-list (exact match)
`)
}

func cmdServe() int {
	logger := log.New(os.Stderr, "[bridge] ", log.LstdFlags)

	// Reuse a live daemon instead of spawning a second instance (017).
	if err := pidfileAliveAndHealthy(); err == nil {
		logger.Printf("already running — exiting (reuse the existing daemon)")
		return 0
	}
	pidfile.Remove() // stale by construction now

	s := server.New(server.Config{
		StrictOrigin: os.Getenv("EXCALI_BRIDGE_ORIGIN"),
		Logger:       logger,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		_ = s.Shutdown(ctx)
	}()

	if err := s.StartLAN(ctx); err != nil {
		logger.Printf("LAN listener not started: %v", err)
	} else if port := s.LANPort(); port != 0 {
		logger.Printf("LAN listener on 0.0.0.0:%d (Canvas transfer only)", port)
	}

	if err := s.ListenAndServe(); err != nil {
		if err == server.ErrAlreadyRunning {
			logger.Printf("already running — exiting")
			return 0
		}
		logger.Printf("fatal: %v", err)
		return 1
	}
	pidfile.Remove()
	return 0
}

// cmdCall runs a JSON-RPC method as a CLI subcommand: `excali-bridge <method> [json]`.
// Prints the result JSON on success (exit 0); the RPC error on failure (exit 1).
func cmdCall(method, paramsJSON string) int {
	var params any
	if paramsJSON != "" {
		if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
			fmt.Fprintf(os.Stderr, "excali-bridge %s: invalid params JSON: %v\n", method, err)
			return 2
		}
	} else {
		params = map[string]any{}
	}
	result, err := client.Call(context.Background(), client.Options{}, method, params)
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge %s: %v\n", method, err)
		return 1
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, result, "", "  "); err == nil {
		fmt.Println(pretty.String())
	} else {
		fmt.Println(string(result))
	}
	return 0
}

func cmdStatus() int {
	info, err := pidfile.Read()
	if err != nil {
		fmt.Println("bridge daemon: not running")
		return 1
	}
	if !pidfile.Alive(info.PID) {
		fmt.Printf("bridge daemon: stale pidfile (pid %d gone)\n", info.PID)
		return 1
	}
	if !healthOK(info.Port) {
		fmt.Printf("bridge daemon: pid %d alive but not answering on :%d\n", info.PID, info.Port)
		return 1
	}
	fmt.Printf("bridge daemon: running (pid=%d port=%d)\n", info.PID, info.Port)
	return 0
}

func pidfileAliveAndHealthy() error {
	info, err := pidfile.Read()
	if err != nil {
		return err
	}
	if !pidfile.Alive(info.PID) {
		return fmt.Errorf("pidfile pid %d not alive", info.PID)
	}
	if !healthOK(info.Port) {
		return fmt.Errorf("daemon not answering on :%d", info.Port)
	}
	return nil
}

func healthOK(port int) bool {
	return server.HealthOK(port)
}
