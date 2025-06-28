# Invariant Eclipse Swap API Documentation

## Overview
REST API server for performing token swaps on Invariant DEX (Eclipse network). Built with Express.js and supports multiple token pairs with automatic pool discovery and routing.

## Base URL
```
http://localhost:3000/api
```

## Authentication
All swap operations require a private key in the request body. The server doesn't store keys - they're used only for signing transactions.

---

## Endpoints

### 1. Health Check
**GET** `/health`

Check if the server and Eclipse network connection are healthy.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "network": "Eclipse Mainnet",
  "currentSlot": 12345678,
  "timestamp": "2025-06-28T10:30:00.000Z"
}
```

### 2. Get Supported Tokens
**GET** `/tokens`

Retrieve list of all supported tokens for trading.

**Response:**
```json
{
  "success": true,
  "tokens": [
    {
      "symbol": "ETH",
      "name": "Ethereum (Native SOL)",
      "mint": "So11111111111111111111111111111111111111112",
      "decimals": 9
    },
    {
      "symbol": "USDT",
      "name": "Tether USD",
      "mint": "CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm",
      "decimals": 6
    }
  ]
}
```

### 3. Get Available Pools
**GET** `/pools/:fromToken/:toToken`

Find available liquidity pools for a token pair.

**Parameters:**
- `fromToken` - Source token symbol (e.g., "ETH")
- `toToken` - Destination token symbol (e.g., "USDT")

**Example:** `GET /pools/ETH/USDT`

**Response:**
```json
{
  "success": true,
  "pair": "ETH/USDT",
  "poolsFound": 3,
  "pools": [
    {
      "tokenX": "CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm",
      "tokenY": "So11111111111111111111111111111111111111112",
      "fee": "100000000",
      "feePercent": "0.1000%",
      "tickSpacing": 1
    }
  ]
}
```

### 4. Get Token Balance
**POST** `/balance`

Check token balance for a specific wallet.

**Request Body:**
```json
{
  "token": "ETH",
  "privateKey": "your_base58_private_key"
}
```

**Response:**
```json
{
  "success": true,
  "token": "ETH",
  "balance": 1.5,
  "wallet": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

### 5. Get Swap Quote
**POST** `/quote`

Get estimated output amount for a swap without executing it.

**Request Body:**
```json
{
  "fromToken": "ETH",
  "toToken": "USDT", 
  "amount": 0.1,
  "slippage": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "fromToken": "ETH",
  "toToken": "USDT",
  "fromAmount": "0.1",
  "estimatedToAmount": "235.67",
  "priceImpact": "0.02%",
  "fee": "0.1000%",
  "slippage": "0.5%"
}
```

### 6. Execute Swap
**POST** `/swap`

Perform a token swap transaction.

**Request Body:**
```json
{
  "fromToken": "ETH",
  "toToken": "USDT",
  "amount": 0.1,
  "slippage": 0.5,
  "privateKey": "your_base58_private_key"
}
```

**Response (Success):**
```json
{
  "success": true,
  "transactionHash": "5KJp7p2DqNKZk4YB7mh8GfZ2K3VX9QWp8Y6C4sR7L1nE3F9M",
  "fromToken": "ETH",
  "toToken": "USDT", 
  "fromAmount": "0.1",
  "estimatedToAmount": "235.67",
  "poolUsed": {
    "address": "PoolAddressHere...",
    "fee": "100000000",
    "feePercent": "0.1000%"
  }
}
```

### 7. Market Statistics
**GET** `/market/stats`

Get overall market statistics and pool counts.

**Response:**
```json
{
  "success": true,
  "totalPools": 295,
  "registeredTokensWithPools": {
    "ETH": 141,
    "USDT": 21,
    "USDC": 64
  },
  "allTokenStats": {
    "So11111111111111111111111111111111111111112": 141,
    "CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm": 21
  }
}
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error description here"
}
```

**Common HTTP Status Codes:**
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (endpoint doesn't exist)
- `500` - Internal Server Error

---

## Supported Tokens

Current token registry includes:

| Symbol | Name | Network | Type |
|--------|------|---------|------|
| ETH/SOL | Ethereum (Native SOL) | Eclipse | Native |
| USDT | Tether USD | Eclipse | Stablecoin |
| USDC | USD Coin | Eclipse | Stablecoin |
| WBTC | Wrapped Bitcoin | Eclipse | Asset |

*More tokens can be added to the registry as they become available on Eclipse.*

---

## Usage Examples

### 1. Basic Swap Flow
```bash
# 1. Check supported tokens
curl http://localhost:3000/api/tokens

# 2. Get a quote
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "fromToken": "ETH",
    "toToken": "USDT",
    "amount": 0.1
  }'

# 3. Execute the swap
curl -X POST http://localhost:3000/api/swap \
  -H "Content-Type: application/json" \
  -d '{
    "fromToken": "ETH", 
    "toToken": "USDT",
    "amount": 0.1,
    "slippage": 0.5,
    "privateKey": "your_private_key_here"
  }'
```

### 2. Check Pool Availability
```bash
# Check if ETH/USDT pools exist
curl http://localhost:3000/api/pools/ETH/USDT

# Check ETH/USDC pools  
curl http://localhost:3000/api/pools/ETH/USDC
```

### 3. Monitor Balance
```bash
curl -X POST http://localhost:3000/api/balance \
  -H "Content-Type: application/json" \
  -d '{
    "token": "ETH",
    "privateKey": "your_private_key_here"
  }'
```

---

## Installation & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create a `.env` file:
```env
PORT=3000
WALLET_PRIVATE_KEY=your_default_private_key_here
```

### 3. Start Server
```bash
# Production
npm run server

# Development (with auto-reload)
npm run server:dev
```

---

## Features

### ✅ Implemented
- Multi-token support with extensible registry
- Automatic pool discovery and routing
- Smart fallback to alternative pools
- Swap simulation and quotes
- Balance checking
- Market statistics
- Comprehensive error handling
- CORS support for web clients

### 🔄 Advanced Features
- **Smart Routing**: Automatically finds the best available pool
- **Slippage Protection**: Configurable slippage tolerance
- **Pool Fallback**: Tries multiple pools if the first fails
- **Fee Optimization**: Prioritizes lower fee pools
- **Token Account Management**: Auto-creates token accounts if needed

### 🚀 Extensible Design
- Easy to add new tokens to registry
- Modular pool discovery system
- Configurable transaction parameters
- Support for custom RPC endpoints

---

## Security Notes

⚠️ **Important Security Considerations:**

1. **Private Keys**: Never log or store private keys
2. **HTTPS**: Use HTTPS in production
3. **Rate Limiting**: Implement rate limiting for production use
4. **Input Validation**: All inputs are validated but add additional checks as needed
5. **Environment Variables**: Store sensitive config in environment variables
6. **Network Security**: Restrict API access in production environments

---

## Troubleshooting

### Common Issues

1. **"Token not supported"**
   - Check `/api/tokens` for supported token list
   - Verify token symbol spelling

2. **"No liquidity pools found"**
   - Check `/api/pools/{from}/{to}` to see available pools
   - Try alternative token pairs

3. **"Simulation failed"**
   - Reduce swap amount
   - Increase slippage tolerance
   - Check token balance

4. **Network errors**
   - Check `/api/health` for network status
   - Verify Eclipse RPC endpoint is accessible

### Debug Mode
Enable detailed logging by setting:
```env
NODE_ENV=development
```

---

*This API server implements the same robust swap logic from the TypeScript app but exposes it via REST endpoints for integration with web applications, trading bots, or other services.*
