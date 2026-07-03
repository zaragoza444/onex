package main

import (
	"context"
	"flag"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/onex-blockchain/onex/internal/bridge"
	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/legacy"
)

func main() {
	configPath := flag.String("config", "", "bridge config JSON (default ~/.onex/bridge.json)")
	nodeURL := flag.String("node", "", "OneX node API URL")
	listen := flag.String("listen", "", "bridge listen address")
	walletPath := flag.String("wallet", "", "wallet JSON file path")
	flag.Parse()

	cfg, err := bridge.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	savePath := *configPath
	if savePath == "" {
		savePath = bridge.ConfigPath()
	}
	if cfg.ProjectRoot == "" {
		cfg.ProjectRoot = findProjectRoot()
	}
	legacy.LoadProjectEnv(cfg.ProjectRoot)
	if _, err := chains.EnsureBridgeSenderKey(); err != nil {
		log.Printf("bridge: evm settlement: %v", err)
	} else if addr, err := chains.BridgeSenderAddress(); err == nil {
		log.Printf("bridge: evm sender %s", addr)
	}
	if *nodeURL != "" {
		cfg.NodeURL = *nodeURL
	}
	if *listen != "" {
		cfg.Listen = *listen
	}
	if *walletPath != "" {
		cfg.WalletPath = *walletPath
	}
	_ = bridge.SaveConfig(savePath, cfg)

	b := bridge.New(cfg)
	if cfg.WalletPath != "" {
		if err := b.LoadWallet(cfg.WalletPath); err != nil {
			if os.IsNotExist(err) {
				log.Printf("bridge: no wallet at %s (create via Wallet UI)", cfg.WalletPath)
			} else {
				log.Printf("bridge: wallet load: %v", err)
			}
		} else {
			log.Printf("bridge: wallet %s", b.WalletAddress())
		}
	}
	if err := b.Node().Ping(); err != nil {
		log.Printf("bridge: warning — node not reachable at %s: %v", cfg.NodeURL, err)
		log.Printf("bridge: start the node first (run-onex.bat)")
	} else {
		st, _ := b.Node().Status()
		if st != nil {
			log.Printf("bridge: connected to %s height=%d", st.ChainID, st.Height)
		}
	}

	srv := bridge.NewServer(b)
	if b.IsProduction() {
		log.Printf("bridge: production bootstrap (background)…")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			res := b.BootstrapProduction(ctx, "")
			if res == nil {
				return
			}
			if ok, _ := res["ok"].(bool); ok {
				log.Printf("bridge: production bootstrap complete")
			} else {
				log.Printf("bridge: production bootstrap partial: %v", res["steps"])
			}
		}()
	}
	log.Fatal(srv.Start(cfg.Listen))
}

func findProjectRoot() string {
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for _, d := range []string{dir, filepath.Join(dir, "..")} {
			if _, err := os.Stat(filepath.Join(d, "configs", "chains.json")); err == nil {
				abs, _ := filepath.Abs(d)
				return abs
			}
		}
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "."
}
