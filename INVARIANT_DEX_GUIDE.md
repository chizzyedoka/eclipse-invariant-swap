# Invariant DEX Swap Guide for Eclipse Network

## Table of Contents
1. [Introduction](#introduction)
2. [Core Concepts](#core-concepts)
3. [Common Issues & Solutions](#common-issues--solutions)
4. [Implementation Guide](#implementation-guide)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Introduction

This guide covers integrating with Invariant DEX on the Eclipse network (Solana-based L2) for performing token swaps. Invariant is an automated market maker (AMM) protocol that allows decentralized trading of tokens through liquidity pools.

### Key Technologies
- **Eclipse Network**: Solana L2 with Ethereum compatibility
- **Invariant Protocol**: Concentrated liquidity AMM
- **SDK**: `@invariant-labs/sdk-eclipse`
- **Native Token**: SOL (referred to as "ETH" in Eclipse context)

---

## Core Concepts

### 1. Automated Market Makers (AMMs)

**What is an AMM?**
- A decentralized exchange protocol that uses mathematical formulas to price assets
- Instead of order books, AMMs use liquidity pools containing pairs of tokens
- Users trade against these pools, with prices determined by the ratio of tokens

**Invariant's Concentrated Liquidity Model:**
- Liquidity providers can specify price ranges for their capital
- More capital-efficient than traditional constant product AMMs
- Uses tick-based pricing similar to Uniswap V3

### 2. Liquidity Pools

**Pool Structure:**
```typescript
Pool {
  tokenX: PublicKey,    // First token in the pair
  tokenY: PublicKey,    // Second token in the pair
  fee: BN,             // Fee tier (e.g., 100000000 = 1%)
  tickSpacing: number, // Minimum price movement
  address: PublicKey   // Unique pool address
}
```

**Pool Existence:**
- Pools are created permissionlessly by users
- Multiple pools can exist for the same token pair with different fee tiers
- Not all theoretical pairs have active pools

### 3. Fee Tiers

**Common Fee Tiers (Eclipse/Invariant):**
```typescript
// Fee values are in basis points * 10^7
const commonFees = {
  "0.01%": new BN(100000000),    // 100,000,000
  "0.05%": new BN(500000000),    // 500,000,000  
  "0.1%":  new BN(1000000000),   // 1,000,000,000
  "0.3%":  new BN(3000000000),   // 3,000,000,000
  "1%":    new BN(10000000000),  // 10,000,000,000
};
```

**Fee Tier Selection:**
- Lower fees (0.01%, 0.05%) for stable pairs (ETH/USDC)
- Higher fees (0.3%, 1%) for volatile or exotic pairs
- Fee affects both trading cost and LP rewards

### 4. Token Standards

**Eclipse Token Programs:**
```typescript
// Native SOL (wrapped as WSOL)
const ETH_MINT = NATIVE_MINT; // So11111...112

// SPL Token (legacy)
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// SPL Token 2022 (new standard)
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
```

**Token Program Selection:**
- USDT/USDC typically use TOKEN_2022_PROGRAM_ID
- Native SOL (ETH) uses TOKEN_PROGRAM_ID
- Must match the correct program for each token

### 5. Swap Direction (xToY)

**Understanding Swap Direction:**
```typescript
// Pool: tokenX ↔ tokenY
const xToY = true;  // Swap tokenX → tokenY
const xToY = false; // Swap tokenY → tokenX
```

**Determining Direction:**
```typescript
// If you want to swap FROM_TOKEN to TO_TOKEN
const pair = new Pair(FROM_TOKEN, TO_TOKEN, feeTier);
const xToY = pair.tokenX.equals(FROM_TOKEN);
```

### 6. Pair Constructor Evolution

**Current Signature (SDK v0.0.124+):**
```typescript
new Pair(tokenA: PublicKey, tokenB: PublicKey, feeTier: FeeTier)
```

**FeeTier Object:**
```typescript
interface FeeTier {
  fee: BN;           // Fee amount
  tickSpacing: number; // Tick spacing
}
```

**Address Generation:**
```typescript
const pair = new Pair(tokenA, tokenB, feeTier);
const poolAddress = pair.getAddress(marketProgramId);
```

---

## Common Issues & Solutions

### 1. "Account does not exist or has no data"

**Problem:**
Generated pool addresses don't match actual on-chain pools.

**Root Cause:**
- Using arbitrary fee tiers instead of actual on-chain fee values
- Pool address derivation depends on exact fee tier parameters

**Solution:**
```typescript
// ❌ Wrong: Using arbitrary fee values
const feeTier = { fee: new BN(1000), tickSpacing: 1 };

// ✅ Correct: Use actual on-chain pool fee values
const actualPools = await market.getAllPools();
const ethUsdtPools = actualPools.filter(pool => 
  (pool.tokenX.equals(ETH_MINT) && pool.tokenY.equals(USDT_MINT)) ||
  (pool.tokenX.equals(USDT_MINT) && pool.tokenY.equals(ETH_MINT))
);

// Use the actual pool's fee structure
const feeTier = {
  fee: ethUsdtPools[0].fee,
  tickSpacing: ethUsdtPools[0].tickSpacing || 1
};
```

### 2. "Pool doesn't exist for this pair"

**Problem:**
Attempting to trade a pair that has no liquidity pool.

**Diagnosis:**
```typescript
async function findAvailablePools(market: Market, tokenA: PublicKey, tokenB: PublicKey) {
  const allPools = await market.getAllPools();
  const matchingPools = allPools.filter(pool =>
    (pool.tokenX.equals(tokenA) && pool.tokenY.equals(tokenB)) ||
    (pool.tokenX.equals(tokenB) && pool.tokenY.equals(tokenA))
  );
  
  console.log(`Found ${matchingPools.length} pools for the pair`);
  return matchingPools;
}
```

**Solution:**
- Check pool existence before attempting swaps
- Try alternative token pairs (ETH/USDC vs ETH/USDT)
- Use multiple fee tiers

### 3. Token Program Mismatch

**Problem:**
Using wrong token program for associated token accounts.

**Solution:**
```typescript
function getTokenProgram(mint: PublicKey): PublicKey {
  if (mint.equals(USDT_MINT) || mint.equals(USDC_MINT)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

const tokenAccount = getAssociatedTokenAddressSync(
  mint,
  owner,
  true,
  getTokenProgram(mint)
);
```

### 4. Simulation Failures

**Problem:**
Swap simulation fails before execution.

**Common Causes:**
- Insufficient liquidity for the swap amount
- Price impact too high
- Incorrect swap direction
- Wrong pool address

**Solution:**
```typescript
// Always simulate before swapping
const simulation = await swapSimulation(
  xToY,
  true, // byAmountIn
  swapAmount,
  undefined, // targetAmount
  slippage,
  market,
  actualPoolAddress, // Use real pool address
  TICK_CROSSES_PER_IX_NATIVE_TOKEN
);

if (simulation.status !== SimulationStatus.Ok) {
  throw new Error(`Simulation failed: ${simulation.status}`);
}
```

### 5. Fee Tier Address Confusion

**Problem:**
Confusion about `feeTierAddress` parameter in Pair constructor.

**Clarification:**
- Modern SDK doesn't require separate `feeTierAddress`
- Pair constructor generates addresses internally
- Use actual on-chain fee values, not arbitrary ones

---

## Implementation Guide

### 1. Environment Setup

```typescript
// package.json dependencies
{
  "@invariant-labs/sdk-eclipse": "^0.0.124",
  "@solana/web3.js": "^1.95.0",
  "@solana/spl-token": "^0.4.8",
  "bn.js": "^5.2.1"
}

// Environment variables
WALLET_PRIVATE_KEY=your_base58_private_key
```

### 2. Market Initialization

```typescript
import { Market, Network } from "@invariant-labs/sdk-eclipse";

async function initializeMarket(): Promise<Market> {
  const market = await Market.build(
    Network.MAIN,
    keypair,
    connection,
    new PublicKey("iNvTyprs4TX8m6UeUEkeqDFjAL9zRCRWcexK9Sd4WEU") // Invariant program ID
  );
  return market;
}
```

### 3. Pool Discovery

```typescript
async function findBestPool(market: Market, tokenA: PublicKey, tokenB: PublicKey) {
  const allPools = await market.getAllPools();
  
  // Filter for our token pair
  const relevantPools = allPools.filter(pool =>
    (pool.tokenX.equals(tokenA) && pool.tokenY.equals(tokenB)) ||
    (pool.tokenX.equals(tokenB) && pool.tokenY.equals(tokenA))
  );
  
  // Sort by fee (lower fees first, usually more liquid)
  relevantPools.sort((a, b) => a.fee.cmp(b.fee));
  
  return relevantPools;
}
```

### 4. Safe Swap Implementation

```typescript
async function performSafeSwap(
  market: Market,
  fromToken: PublicKey,
  toToken: PublicKey,
  amount: BN
): Promise<string | null> {
  
  // 1. Find available pools
  const pools = await findBestPool(market, fromToken, toToken);
  if (pools.length === 0) {
    throw new Error("No pools available for this pair");
  }
  
  // 2. Try each pool until one works
  for (const pool of pools) {
    try {
      // 3. Create pair with actual pool parameters
      const feeTier = {
        fee: pool.fee,
        tickSpacing: pool.tickSpacing || 1
      };
      const pair = new Pair(pool.tokenX, pool.tokenY, feeTier);
      
      // 4. Determine swap direction
      const xToY = pair.tokenX.equals(fromToken);
      
      // 5. Get token accounts
      const accountX = getAssociatedTokenAddressSync(
        pair.tokenX,
        keypair.publicKey,
        true,
        getTokenProgram(pair.tokenX)
      );
      
      const accountY = getAssociatedTokenAddressSync(
        pair.tokenY,
        keypair.publicKey,
        true,
        getTokenProgram(pair.tokenY)
      );
      
      // 6. Simulate swap
      const poolAddress = pair.getAddress(market.program.programId);
      const simulation = await swapSimulation(
        xToY,
        true,
        amount,
        undefined,
        toDecimal(0, 0), // 0% slippage
        market,
        poolAddress,
        40 // tick crosses
      );
      
      if (simulation.status !== SimulationStatus.Ok) {
        console.log(`Simulation failed for pool: ${simulation.status}`);
        continue;
      }
      
      // 7. Execute swap
      const txHash = await market.swap({
        xToY,
        estimatedPriceAfterSwap: simulation.priceAfterSwap,
        pair,
        amount,
        slippage: toDecimal(0, 0),
        byAmountIn: true,
        accountX,
        accountY,
        owner: keypair.publicKey
      }, keypair);
      
      return txHash;
      
    } catch (error) {
      console.log(`Pool failed, trying next:`, error.message);
      continue;
    }
  }
  
  throw new Error("All pools failed");
}
```

### 5. SOL Wrapping for Native Swaps

```typescript
async function wrapSol(amount: number): Promise<PublicKey> {
  const lamports = amount * LAMPORTS_PER_SOL;
  
  const associatedTokenAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    keypair.publicKey
  );
  
  const instructions = [
    // Create ATA if needed
    createAssociatedTokenAccountInstruction(
      keypair.publicKey,
      associatedTokenAccount,
      keypair.publicKey,
      NATIVE_MINT
    ),
    // Transfer SOL to the account
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: associatedTokenAccount,
      lamports
    }),
    // Sync to convert to wrapped SOL
    createSyncNativeInstruction(associatedTokenAccount)
  ];
  
  const tx = new Transaction().add(...instructions);
  await sendAndConfirmTransaction(connection, tx, [keypair]);
  
  return associatedTokenAccount;
}
```

---

## Best Practices

### 1. Pool Discovery Strategy

```typescript
// ✅ Always check pool existence
async function smartSwap(market: Market) {
  const tokenPairs = [
    { from: ETH_MINT, to: USDT_MINT, name: "ETH/USDT" },
    { from: ETH_MINT, to: USDC_MINT, name: "ETH/USDC" }
  ];
  
  for (const pair of tokenPairs) {
    const pools = await findBestPool(market, pair.from, pair.to);
    if (pools.length > 0) {
      return attemptSwap(market, pair.from, pair.to, pools);
    }
  }
}
```

### 2. Error Handling

```typescript
// ✅ Comprehensive error handling
try {
  const txHash = await performSwap();
  console.log("Success:", txHash);
} catch (error) {
  if (error.message.includes("Account does not exist")) {
    console.log("Pool not found - try different fee tier");
  } else if (error.message.includes("insufficient")) {
    console.log("Insufficient balance or liquidity");
  } else {
    console.log("Unexpected error:", error.message);
  }
}
```

### 3. Amount Management

```typescript
// ✅ Safe amount calculation
async function getSwapAmount(): Promise<BN> {
  const balance = await getAvailableWrappedSolBalance();
  const swapAmount = balance.muln(40).divn(100); // 40% of balance
  
  if (swapAmount.lte(new BN(1000))) { // Minimum viable amount
    throw new Error("Amount too small for swap");
  }
  
  return swapAmount;
}
```

### 4. Slippage Management

```typescript
// ✅ Progressive slippage tolerance
const slippageSettings = [
  toDecimal(0, 0),    // 0% - try first
  toDecimal(1, 2),    // 0.01%
  toDecimal(5, 2),    // 0.05%
  toDecimal(10, 2)    // 0.1%
];

for (const slippage of slippageSettings) {
  try {
    return await attemptSwapWithSlippage(slippage);
  } catch (error) {
    continue; // Try next slippage level
  }
}
```

---

## Troubleshooting

### Diagnostic Commands

```typescript
// Check market status
const pools = await market.getAllPools();
console.log(`Total pools: ${pools.length}`);

// Check specific token pools
const ethPools = pools.filter(p => 
  p.tokenX.equals(ETH_MINT) || p.tokenY.equals(ETH_MINT)
);
console.log(`ETH pools: ${ethPools.length}`);

// Check balances
const balance = await connection.getBalance(keypair.publicKey);
console.log(`SOL balance: ${balance / LAMPORTS_PER_SOL}`);

// Check wrapped SOL
const wrappedBalance = await getAvailableWrappedSolBalance();
console.log(`Wrapped SOL: ${wrappedBalance.toString()}`);
```

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Account does not exist" | Wrong pool address | Use actual on-chain fee values |
| "Pool doesn't exist" | No liquidity for pair | Try different token pairs |
| "Simulation failed" | Insufficient liquidity | Reduce swap amount |
| "Token account not found" | Missing ATA | Create associated token account |
| "Invalid instruction" | Wrong token program | Use correct TOKEN_PROGRAM_ID |

### Network Issues

```typescript
// ✅ Robust connection handling
const connection = new Connection(ECLIPSE_RPC_URL, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60000
});

// Retry logic for network calls
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error("Max retries exceeded");
}
```

---

## Conclusion

Successful Invariant DEX integration requires:

1. **Understanding AMM fundamentals** - pools, fees, liquidity
2. **Proper pool discovery** - using actual on-chain data
3. **Correct token handling** - programs, accounts, wrapping
4. **Robust error handling** - simulation, retries, fallbacks
5. **Smart routing** - multiple pairs, fee tiers, slippage

The key insight is that pool addresses are deterministically generated from exact fee tier parameters, so using actual on-chain pool data is essential for successful swaps.

---

*This guide is based on SDK version 0.0.124 and Eclipse mainnet as of June 2025.*
