package contract

import "testing"

func TestIsValidBridgeToken(t *testing.T) {
	valid := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" // 64 hex
	short := "deadbeef"
	badChars := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeG"
	empty := ""

	cases := []struct {
		name  string
		token string
		want  bool
	}{
		{"64-hex chars", valid, true},
		{"short token", short, false},
		{"non-hex char", badChars, false},
		{"empty", empty, false},
	}
	for _, tc := range cases {
		if got := IsValidBridgeToken(tc.token); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestBridgeStopMirror locks the 045 wire additions to the TS source of
// truth (packages/excali-shared/src/agent-bridge.ts): the two constants and
// the DaemonLocalMethods map entry must match exactly.
func TestBridgeStopMirror(t *testing.T) {
	if BridgeStopMethod != "bridge.stop" {
		t.Errorf("BridgeStopMethod = %q, want \"bridge.stop\"", BridgeStopMethod)
	}
	if JSONRPCErrorRequiresActivePage != -32007 {
		t.Errorf("JSONRPCErrorRequiresActivePage = %d, want -32007", JSONRPCErrorRequiresActivePage)
	}
	if !DaemonLocalMethods["bridge.stop"] {
		t.Error("DaemonLocalMethods[\"bridge.stop\"] is false")
	}
}
