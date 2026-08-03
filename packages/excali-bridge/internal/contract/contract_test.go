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
