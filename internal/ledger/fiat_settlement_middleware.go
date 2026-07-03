package ledger

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	EthereumMainnetChain = "ethereum"
	DefaultStableSymbol  = "ONEXUSD"
	DefaultEthLoadPct    = 2.0
)

// FiatSettlementMiddlewareConfig configures stablecoin mainnet settlement.
type FiatSettlementMiddlewareConfig struct {
	ChainID        string  `json:"chainId"`
	StableSymbol   string  `json:"stableSymbol"`
	EthLoadPercent float64 `json:"ethLoadPercent"`
	MintStablecoin bool    `json:"mintStablecoin"`
}

func DefaultFiatSettlementMiddlewareConfig() FiatSettlementMiddlewareConfig {
	return FiatSettlementMiddlewareConfig{
		ChainID:        EthereumMainnetChain,
		StableSymbol:   DefaultStableSymbol,
		EthLoadPercent: DefaultEthLoadPct,
		MintStablecoin: true,
	}
}

func LoadFiatSettlementMiddlewareConfig() FiatSettlementMiddlewareConfig {
	cfg := DefaultFiatSettlementMiddlewareConfig()
	path := strings.TrimSpace(os.Getenv("ONEX_FIAT_SETTLEMENT_CONFIG"))
	if path == "" {
		path = filepath.Join("configs", "fiat-settlement-middleware.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	if cfg.ChainID == "" {
		cfg.ChainID = EthereumMainnetChain
	}
	if cfg.StableSymbol == "" {
		cfg.StableSymbol = DefaultStableSymbol
	}
	if cfg.EthLoadPercent <= 0 || cfg.EthLoadPercent >= 100 {
		cfg.EthLoadPercent = DefaultEthLoadPct
	}
	return cfg
}

// FiatSettlementMiddlewareRequest converts all fiat ledger balances through M1–M4+MINT pools
// into USDC + ETH on Ethereum mainnet and mints a stablecoin vault balance.
type FiatSettlementMiddlewareRequest struct {
	Preview         bool    `json:"preview"`
	EthLoadPercent  float64 `json:"ethLoadPercent,omitempty"`
	ReceiverAddress string  `json:"receiverAddress,omitempty"`
	ReceiverChain   string  `json:"receiverChain,omitempty"`
	MintStablecoin  *bool   `json:"mintStablecoin,omitempty"`
	StableSymbol    string  `json:"stableSymbol,omitempty"`
	Note            string  `json:"note,omitempty"`
}

// FiatConversionStep tracks one fiat account routed into a monetary pool.
type FiatConversionStep struct {
	FromAccount string  `json:"fromAccount"`
	FromAsset   string  `json:"fromAsset"`
	Amount      string  `json:"amount"`
	FundClass   string  `json:"fundClass"`
	PoolAccount string  `json:"poolAccount"`
	USDValue    float64 `json:"usdValue"`
	Status      string  `json:"status"`
}

// FiatSettlementMiddlewareResult is the batch settlement output.
type FiatSettlementMiddlewareResult struct {
	Status        string               `json:"status"`
	Preview       bool                 `json:"preview"`
	Steps         []SettlementStep     `json:"steps"`
	Conversions   []FiatConversionStep `json:"conversions"`
	PoolTotals    map[string]string    `json:"poolTotals"`
	USDCAmount    string               `json:"usdcAmount"`
	ETHAmount     string               `json:"ethAmount"`
	MintAmount    string               `json:"mintAmount"`
	MintSymbol    string               `json:"mintSymbol"`
	MintVault     string               `json:"mintVault"`
	ChainID       string               `json:"chainId"`
	TotalFiatUSD  float64              `json:"totalFiatUsd"`
	SettlementRef string               `json:"settlementRef,omitempty"`
}

func isFiatLedgerAccount(a *BookAccount) bool {
	if a == nil {
		return false
	}
	id := strings.ToLower(a.ID)
	if strings.HasPrefix(id, "book:") || strings.HasPrefix(id, "pool:") || strings.HasPrefix(id, "mint:") {
		return false
	}
	return isFiat(a.Asset)
}

func (s *BookStore) listFiatAccounts() ([]*BookAccount, error) {
	accounts, err := s.ListAccounts()
	if err != nil {
		return nil, err
	}
	out := make([]*BookAccount, 0)
	for i := range accounts {
		a := accounts[i]
		if !isFiatLedgerAccount(&a) {
			continue
		}
		if parseHuman(a.Balance) <= 0 {
			continue
		}
		ac := a
		out = append(out, &ac)
	}
	return out, nil
}

func (s *BookStore) ensurePoolAccount(fc string) *BookAccount {
	id := poolAccountID(fc)
	fc = NormalizeFundClass(fc)
	if acct, err := s.GetAccount(id); err == nil {
		return acct
	}
	return &BookAccount{
		ID:        id,
		Source:    SourceImport,
		Mode:      ModeFiat,
		Asset:     "USD",
		FundClass: fc,
		Balance:   "0",
	}
}

func (s *BookStore) tagEthereumVault(id, asset string) {
	acct, err := s.GetAccount(id)
	if err != nil || acct == nil {
		return
	}
	acct.ChainID = EthereumMainnetChain
	acct.Asset = asset
	acct.UpdatedAt = time.Now().Unix()
	s.mu.Lock()
	s.data.Accounts[id] = acct
	s.mu.Unlock()
}

// RunFiatSettlementMiddleware converts all fiat balances → M1+M2+M3+M4+MINT pools → USDC+ETH → stable mint.
func (s *BookStore) RunFiatSettlementMiddleware(
	req FiatSettlementMiddlewareRequest,
	cfg FiatSettlementMiddlewareConfig,
	prices map[string]PriceQuote,
	tokens map[string]TokenMeta,
	settle func(TransferRecord, *ExternalDestination) (string, error),
) (*FiatSettlementMiddlewareResult, error) {
	if err := s.load(); err != nil {
		return nil, err
	}

	ethPct := req.EthLoadPercent
	if ethPct <= 0 {
		ethPct = cfg.EthLoadPercent
	}
	if ethPct <= 0 || ethPct >= 100 {
		ethPct = DefaultEthLoadPct
	}

	chainID := strings.TrimSpace(req.ReceiverChain)
	if chainID == "" {
		chainID = cfg.ChainID
	}
	if chainID == "" {
		chainID = EthereumMainnetChain
	}

	stableSymbol := strings.ToUpper(strings.TrimSpace(req.StableSymbol))
	if stableSymbol == "" {
		stableSymbol = cfg.StableSymbol
	}
	if stableSymbol == "" {
		stableSymbol = DefaultStableSymbol
	}

	mintStable := cfg.MintStablecoin
	if req.MintStablecoin != nil {
		mintStable = *req.MintStablecoin
	}

	fiatAccounts, err := s.listFiatAccounts()
	if err != nil {
		return nil, err
	}
	if len(fiatAccounts) == 0 {
		return nil, fmt.Errorf("no fiat ledger accounts with balance")
	}

	res := &FiatSettlementMiddlewareResult{
		Status:     "preview",
		Preview:    req.Preview,
		Steps:      []SettlementStep{{Phase: "quote", Status: "done", Detail: "fiat-batch-middleware"}},
		PoolTotals: make(map[string]string),
		MintSymbol: stableSymbol,
		MintVault:  mintVaultID(chainID, stableSymbol),
		ChainID:    chainID,
	}

	var totalUSD float64
	for _, acct := range fiatAccounts {
		amt := formatFloat(parseHuman(acct.Balance))
		fc := RouteFiatToPoolFundClass(acct.FundClass)
		poolID := poolAccountID(fc)

		conv, err := ConvertAmount(ConvertRequest{
			FromAsset: acct.Asset,
			ToAsset:   "USD",
			Amount:    amt,
		}, prices, tokens)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", acct.ID, err)
		}

		step := FiatConversionStep{
			FromAccount: acct.ID,
			FromAsset:   acct.Asset,
			Amount:      amt,
			FundClass:   fc,
			PoolAccount: poolID,
			USDValue:    conv.FiatUSD,
			Status:      "pending",
		}

		if req.Preview {
			step.Status = "preview"
			res.Conversions = append(res.Conversions, step)
			totalUSD += conv.FiatUSD
			res.PoolTotals[fc] = formatFloat(parseHuman(res.PoolTotals[fc]) + conv.FiatUSD)
			continue
		}

		xfer, err := s.Transfer(TransferRequest{
			FromAccount: acct.ID,
			ToAccount:   poolID,
			Amount:      amt,
			ConvertTo:   "USD",
			Note:        "fiat-settlement-pool",
		}, prices, nil)
		if err != nil {
			step.Status = "failed"
			res.Conversions = append(res.Conversions, step)
			return nil, fmt.Errorf("pool %s: %w", acct.ID, err)
		}
		step.Status = xfer.Status
		res.Conversions = append(res.Conversions, step)
		totalUSD += conv.FiatUSD
		res.PoolTotals[fc] = formatFloat(parseHuman(res.PoolTotals[fc]) + conv.FiatUSD)
		_ = s.ensurePoolAccount(fc)
	}

	res.TotalFiatUSD = totalUSD
	res.Steps = append(res.Steps, SettlementStep{
		Phase:  "aggregate",
		Status: "done",
		Detail: formatFloat(totalUSD) + " USD across M1+M2+M3+M4+MINT",
	})

	ethUSD := totalUSD * ethPct / 100
	usdcUSD := totalUSD - ethUSD

	ethConv, err := ConvertAmount(ConvertRequest{
		FromAsset: "USD",
		ToAsset:   "ETH",
		Amount:    formatFloat(ethUSD),
	}, prices, tokens)
	if err != nil {
		return nil, err
	}
	usdcConv, err := ConvertAmount(ConvertRequest{
		FromAsset: "USD",
		ToAsset:   "USDC",
		Amount:    formatFloat(usdcUSD),
	}, prices, tokens)
	if err != nil {
		return nil, err
	}

	res.USDCAmount = usdcConv.ToAmount
	res.ETHAmount = ethConv.ToAmount
	res.MintAmount = usdcConv.ToAmount

	if req.Preview {
		res.Steps = append(res.Steps,
			SettlementStep{Phase: "convert", Status: "pending", Detail: res.USDCAmount + " USDC + " + res.ETHAmount + " ETH"},
			SettlementStep{Phase: "mint", Status: "pending", Detail: res.MintAmount + " " + stableSymbol + " on " + chainID},
		)
		if strings.TrimSpace(req.ReceiverAddress) != "" {
			res.Steps = append(res.Steps, SettlementStep{
				Phase: "settle", Status: "pending", Detail: chainID + ":" + req.ReceiverAddress,
			})
		}
		return res, nil
	}

	// Drain pools into USDC + ETH vaults on Ethereum mainnet.
	for _, fc := range AggregateFundClasses() {
		poolID := poolAccountID(fc)
		pool, err := s.GetAccount(poolID)
		if err != nil || parseHuman(pool.Balance) <= 0 {
			continue
		}
		poolBal := parseHuman(pool.Balance)
		poolEthUSD := poolBal * ethPct / 100
		poolUSDCUSD := poolBal - poolEthUSD

		if poolUSDCUSD > 0 {
			_, err = s.Transfer(TransferRequest{
				FromAccount: poolID,
				ToAccount:   bookVaultID("USDC"),
				Amount:      formatFloat(poolUSDCUSD),
				ConvertTo:   "USDC",
				Note:        "fiat-settlement-usdc",
			}, prices, nil)
			if err != nil {
				return nil, fmt.Errorf("usdc load: %w", err)
			}
		}
		pool, _ = s.GetAccount(poolID)
		remaining := parseHuman(pool.Balance)
		if remaining > 0 {
			_, err = s.Transfer(TransferRequest{
				FromAccount: poolID,
				ToAccount:   bookVaultID("ETH"),
				Amount:      formatFloat(remaining),
				ConvertTo:   "ETH",
				Note:        "fiat-settlement-eth-gas",
			}, prices, nil)
			if err != nil {
				return nil, fmt.Errorf("eth load: %w", err)
			}
		}
	}

	s.tagEthereumVault(bookVaultID("USDC"), "USDC")
	s.tagEthereumVault(bookVaultID("ETH"), "ETH")

	res.Steps = append(res.Steps, SettlementStep{
		Phase:  "convert",
		Status: "done",
		Detail: res.USDCAmount + " USDC + " + res.ETHAmount + " ETH on " + chainID,
	})

	if mintStable && parseHuman(res.MintAmount) > 0 {
		mintID := mintVaultID(chainID, stableSymbol)
		_, err = s.Transfer(TransferRequest{
			FromAccount: bookVaultID("USDC"),
			ToAccount:   mintID,
			Amount:      res.MintAmount,
			Note:        "stablecoin-mainnet-mint",
		}, prices, nil)
		if err != nil {
			return nil, fmt.Errorf("stable mint: %w", err)
		}
		mintAcct, _ := s.GetAccount(mintID)
		if mintAcct != nil {
			mintAcct.ChainID = chainID
			mintAcct.Asset = stableSymbol
			mintAcct.FundClass = FundMINT
			mintAcct.Mode = ModeReal
			mintAcct.Source = SourceEVM
			mintAcct.UpdatedAt = time.Now().Unix()
			s.mu.Lock()
			s.data.Accounts[mintID] = mintAcct
			s.mu.Unlock()
			_ = s.save()
		}
		res.Steps = append(res.Steps, SettlementStep{
			Phase:  "mint",
			Status: "done",
			Detail: res.MintAmount + " " + stableSymbol + " → " + mintID,
		})
	}

	receiver := strings.TrimSpace(req.ReceiverAddress)
	if receiver == "" {
		for _, k := range []string{"ONEX_ETHEREUM_MASTER_WALLET", "ONEX_EVM_HOLDER"} {
			if v := strings.TrimSpace(os.Getenv(k)); v != "" {
				receiver = v
				break
			}
		}
	}
	if receiver != "" && settle != nil && parseHuman(res.USDCAmount) > 0 {
		extTo := chainID + ":" + receiver
		xfer, err := s.Transfer(TransferRequest{
			FromAccount: bookVaultID("USDC"),
			Amount:      res.USDCAmount,
			ExternalTo:  extTo,
			ConvertTo:   "USDC",
			Note:        "fiat-settlement-mainnet",
		}, prices, settle)
		if err != nil {
			res.Steps = append(res.Steps, SettlementStep{Phase: "settle", Status: "failed", Detail: err.Error()})
			res.Status = "failed"
			return res, err
		}
		res.SettlementRef = xfer.Settlement
		settleStatus := "pending"
		if xfer.Settlement != "" {
			settleStatus = "done"
		}
		res.Steps = append(res.Steps, SettlementStep{
			Phase:  "settle",
			Status: settleStatus,
			Detail: extTo,
		})
	}

	rec := SettlementRecord{
		ID:           fmt.Sprintf("fiat-batch-%d", time.Now().UnixNano()),
		Kind:         SettlementVault,
		Status:       "completed",
		FromAccount:  "fiat:*",
		SourceAsset:  "FIAT",
		SourceAmount: formatFloat(totalUSD),
		PayoutAsset:  stableSymbol,
		PayoutAmount: res.MintAmount,
		Destination:  mintVaultID(chainID, stableSymbol),
		FundClass:    FundMINT,
		FiatUSD:      totalUSD,
		SettlementRef: res.SettlementRef,
		Steps:        res.Steps,
		Note:         req.Note,
		CreatedAt:    time.Now().Unix(),
	}
	_ = s.appendSettlement(rec)

	res.Status = "completed"
	res.Preview = false
	return res, nil
}
