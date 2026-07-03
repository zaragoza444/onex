package chains

import "testing"

func TestParseBlockNumber(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", "latest"},
		{"latest", "latest"},
		{"25429899", "0x184078b"},
		{"0x184078b", "0x184078b"},
	}
	for _, tc := range tests {
		got, err := ParseBlockNumber(tc.in)
		if err != nil {
			t.Fatalf("%q: %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("%q: got %v want %v", tc.in, got, tc.want)
		}
	}
}
