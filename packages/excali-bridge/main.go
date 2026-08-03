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
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/excali-local/excali-bridge/internal/client"
	"github.com/excali-local/excali-bridge/internal/pidfile"
	"github.com/excali-local/excali-bridge/internal/server"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	cmd := "serve"
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "serve":
		return cmdServe()
	case "ping":
		return cmdPing()
	case "status":
		return cmdStatus()
	case "help", "--help", "-h":
		usage()
		return 0
	default:
		fmt.Fprintf(os.Stderr, "excali-bridge: unknown command %q\n", cmd)
		usage()
		return 2
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `excali-bridge — Agent Bridge daemon (Leg B: WS server for the editor page; Leg A: agent CLI)

Usage:
  excali-bridge serve     run the daemon on 127.0.0.1:[17331..17335] (first free);
                          writes the pidfile; runs until SIGINT/SIGTERM
  excali-bridge ping      JSON-RPC ping round-trip (spawns the daemon lazily)
  excali-bridge status    report daemon status from pidfile + /health
  excali-bridge help      this help

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

func cmdPing() int {
	opts := client.Options{}
	result, err := client.Ping(context.Background(), opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "excali-bridge ping: %v\n", err)
		return 1
	}
	fmt.Printf("pong (result=%q)\n", result)
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
