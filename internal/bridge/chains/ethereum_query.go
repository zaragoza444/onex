package chains

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type ethereumRPCRequest struct {
	JSONRPC string        `json:"jsonrpc"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
	ID      int           `json:"id"`
}

type ethereumRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// ParseBlockNumber accepts decimal, hex (0x…), or "latest".
func ParseBlockNumber(raw string) (interface{}, error) {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" || raw == "latest" {
		return "latest", nil
	}
	if strings.HasPrefix(raw, "0x") {
		return raw, nil
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid block number %q", raw)
	}
	return fmt.Sprintf("0x%x", n), nil
}

// EthereumJSONRPC calls the configured QuickNode / Ethereum RPC endpoint.
func EthereumJSONRPC(ctx context.Context, method string, params ...interface{}) (json.RawMessage, error) {
	rpcURL := LoadEthereumRPC()
	if rpcURL == "" {
		return nil, fmt.Errorf("ONEX_ETHEREUM_RPC not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	payload, err := json.Marshal(ethereumRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      1,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rpcURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("ethereum rpc http %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	var out ethereumRPCResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	if out.Error != nil {
		return nil, fmt.Errorf("ethereum rpc: %s", out.Error.Message)
	}
	if len(out.Result) == 0 || string(out.Result) == "null" {
		return nil, fmt.Errorf("ethereum rpc: no result")
	}
	return out.Result, nil
}

// GetEthereumBlock returns eth_getBlockByNumber JSON (fullTx=true includes transaction objects).
func GetEthereumBlock(ctx context.Context, number string, fullTx bool) (json.RawMessage, error) {
	tag, err := ParseBlockNumber(number)
	if err != nil {
		return nil, err
	}
	return EthereumJSONRPC(ctx, "eth_getBlockByNumber", tag, fullTx)
}

// GetEthereumTransaction returns eth_getTransactionByHash JSON.
func GetEthereumTransaction(ctx context.Context, hash string) (json.RawMessage, error) {
	hash = strings.TrimSpace(hash)
	if !strings.HasPrefix(strings.ToLower(hash), "0x") || len(hash) != 66 {
		return nil, fmt.Errorf("valid transaction hash required (0x + 64 hex chars)")
	}
	return EthereumJSONRPC(ctx, "eth_getTransactionByHash", hash)
}

// GetEthereumTransactionReceipt returns eth_getTransactionReceipt JSON.
func GetEthereumTransactionReceipt(ctx context.Context, hash string) (json.RawMessage, error) {
	hash = strings.TrimSpace(hash)
	if !strings.HasPrefix(strings.ToLower(hash), "0x") || len(hash) != 66 {
		return nil, fmt.Errorf("valid transaction hash required (0x + 64 hex chars)")
	}
	return EthereumJSONRPC(ctx, "eth_getTransactionReceipt", hash)
}
