//go:build ignore

package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
)

func main() {
	path := os.Getenv("KEYFILE")
	if path == "" && len(os.Args) > 1 {
		path = os.Args[1]
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	hexKey := strings.TrimPrefix(strings.TrimSpace(string(raw)), "0x")
	key, err := crypto.HexToECDSA(hexKey)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(crypto.PubkeyToAddress(key.PublicKey).Hex())
}
