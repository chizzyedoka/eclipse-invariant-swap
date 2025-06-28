# Invariant DEX Quick Reference

## Essential Imports
```typescript
import { Market, Network, Pair } from "@invariant-labs/sdk-eclipse";
import { SimulationStatus, swapSimulation, toDecimal } from "@invariant-labs/sdk-eclipse/lib/utils";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
```

## Key Constants
```typescript
// Eclipse Network
const ECLIPSE_RPC_URL = "https://mainnetbeta-rpc.eclipse.xyz";
const INVARIANT_PROGRAM_ID = "iNvTyprs4TX8m6UeUEkeqDFjAL9zRCRWcexK9Sd4WEU";

// Tokens
const ETH_MINT = NATIVE_MINT; // So11111111111111111111111111111111111111112
const USDT_MINT = new PublicKey("CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm");
const USDC_MINT = new PublicKey("AKEWE7Bgh87GPp171b4cJPSSZfmZwQ3KaqYqXoKLNAEE");

// Limits
const TICK_CROSSES_PER_IX_NATIVE_TOKEN = 40;
```

## Quick Setup Pattern
```typescript
// 1. Initialize market
const market = await Market.build(Network.MAIN, keypair, connection, INVARIANT_PROGRAM_ID);

// 2. Find pools
const pools = await market.getAllPools();
const ethUsdtPools = pools.filter(p => 
  (p.tokenX.equals(ETH_MINT) && p.tokenY.equals(USDT_MINT)) ||
  (p.tokenX.equals(USDT_MINT) && p.tokenY.equals(ETH_MINT))
);

// 3. Use actual pool fee tier
const feeTier = { 
  fee: ethUsdtPools[0].fee, 
  tickSpacing: ethUsdtPools[0].tickSpacing || 1 
};
const pair = new Pair(ETH_MINT, USDT_MINT, feeTier);
```

## Common Fee Values (Eclipse)
```typescript
// Actual on-chain fee values (not percentages!)
const COMMON_FEES = {
  LOW:    new BN(100000000),   // ~0.1%
  MEDIUM: new BN(500000000),   // ~0.5% 
  HIGH:   new BN(1000000000),  // ~1%
  VERY_HIGH: new BN(3000000000) // ~3%
};
```

## Token Program Selection
```typescript
function getTokenProgram(mint: PublicKey): PublicKey {
  return (mint.equals(USDT_MINT) || mint.equals(USDC_MINT)) 
    ? TOKEN_2022_PROGRAM_ID 
    : TOKEN_PROGRAM_ID;
}
```

## Swap Direction Logic
```typescript
// To swap FROM_TOKEN → TO_TOKEN:
const pair = new Pair(FROM_TOKEN, TO_TOKEN, feeTier);
const xToY = pair.tokenX.equals(FROM_TOKEN);

// Example: ETH → USDT
const pair = new Pair(ETH_MINT, USDT_MINT, feeTier);
const xToY = pair.tokenX.equals(ETH_MINT); // Usually false (USDT < ETH lexicographically)
```

## Complete Swap Template
```typescript
async function quickSwap(fromToken: PublicKey, toToken: PublicKey, amount: BN) {
  // Get actual pools
  const pools = await market.getAllPools();
  const relevantPools = pools.filter(p =>
    (p.tokenX.equals(fromToken) && p.tokenY.equals(toToken)) ||
    (p.tokenX.equals(toToken) && p.tokenY.equals(fromToken))
  ).sort((a, b) => a.fee.cmp(b.fee)); // Sort by fee (lowest first)

  for (const pool of relevantPools) {
    try {
      // Create pair with actual pool parameters
      const feeTier = { fee: pool.fee, tickSpacing: pool.tickSpacing || 1 };
      const pair = new Pair(pool.tokenX, pool.tokenY, feeTier);
      const xToY = pair.tokenX.equals(fromToken);

      // Get accounts
      const accountX = getAssociatedTokenAddressSync(pair.tokenX, keypair.publicKey, true, getTokenProgram(pair.tokenX));
      const accountY = getAssociatedTokenAddressSync(pair.tokenY, keypair.publicKey, true, getTokenProgram(pair.tokenY));

      // Simulate
      const simulation = await swapSimulation(xToY, true, amount, undefined, toDecimal(0,0), market, pair.getAddress(market.program.programId), 40);
      if (simulation.status !== SimulationStatus.Ok) continue;

      // Execute
      return await market.swap({
        xToY, estimatedPriceAfterSwap: simulation.priceAfterSwap, pair, amount,
        slippage: toDecimal(0,0), byAmountIn: true, accountX, accountY, owner: keypair.publicKey
      }, keypair);
    } catch (error) {
      console.log("Pool failed, trying next:", error.message);
      continue;
    }
  }
  throw new Error("All pools failed");
}
```

## Debugging Checklist
- [ ] Market initialized with correct program ID
- [ ] Pools exist for your token pair (`market.getAllPools()`)
- [ ] Using actual on-chain fee values (not arbitrary numbers)
- [ ] Correct token programs for ATAs
- [ ] Sufficient wrapped SOL balance
- [ ] Simulation passes before swap execution
- [ ] Swap direction (xToY) calculated correctly

## Error Quick Fixes
| Error | Quick Fix |
|-------|-----------|
| "Account does not exist" | Use actual pool fee values from `getAllPools()` |
| "Pool doesn't exist" | Check available pairs with diagnostics |
| "Simulation failed" | Reduce amount or increase slippage |
| "Token account not found" | Create ATA with correct token program |
| Network timeout | Add retry logic with delays |
