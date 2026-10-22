package main

import (
	"io"
	"os"
	"testing"
)

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	return capture(t, &os.Stdout, fn)
}

func captureStderr(t *testing.T, fn func()) string {
	t.Helper()
	return capture(t, &os.Stderr, fn)
}

func capture(t *testing.T, target **os.File, fn func()) string {
	t.Helper()
	original := *target
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	*target = w

	done := make(chan string, 1)
	go func() {
		data, _ := io.ReadAll(r)
		done <- string(data)
	}()

	fn()

	w.Close()
	*target = original
	out := <-done
	r.Close()
	return out
}
