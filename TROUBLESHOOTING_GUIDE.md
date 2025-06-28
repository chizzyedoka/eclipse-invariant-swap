# Invariant DEX Troubleshooting Flowchart

## 🔍 Step-by-Step Debugging Process

### 1. Initial Setup Verification
```
Start → Is wallet funded with SOL? 
├─ No → Fund wallet with Eclipse SOL
└─ Yes → Continue to Step 2

Step 2 → Can you connect to Eclipse RPC?
├─ No → Check network connection / RPC URL
└─ Yes → Continue to Step 3

Step 3 → Does market initialization succeed?
├─ No → Verify program ID: iNvTyprs4TX8m6UeUEkeqDFjAL9zRCRWcexK9Sd4WEU
└─ Yes → Continue to Pool Discovery
```

### 2. Pool Discovery Flow
```
Pool Discovery → Run market.getAllPools()
├─ Returns 0 pools → Wrong network or program ID
├─ Returns >0 pools → Check for your token pair
└─ Error → Network or connection issue

Token Pair Check → Filter pools for your tokens
├─ No matching pools → Try alternative pairs (ETH/USDC vs ETH/USDT)
├─ Found pools → Continue to Fee Tier Analysis
└─ Error → Token mint addresses incorrect
```

### 3. Fee Tier Analysis
```
Fee Analysis → Examine actual pool fees
├─ Fees like 100000000, 500000000 → Use these exact values
├─ No pools with reasonable fees → Pair may be illiquid
└─ Multiple fee tiers → Try lowest fee first (most liquid)

Fee Tier Usage → Create Pair with actual fees
├─ Success → Continue to Swap Direction
└─ Error → Fee tier parameters incorrect
```

### 4. Swap Direction Logic
```
Direction Check → Determine xToY boolean
├─ pair.tokenX.equals(FROM_TOKEN) → xToY = true
├─ pair.tokenY.equals(FROM_TOKEN) → xToY = false
└─ Neither matches → Pair creation error

Example: ETH → USDT
├─ Pair(ETH_MINT, USDT_MINT) usually creates Pair(USDT, ETH)
├─ So tokenX = USDT, tokenY = ETH
└─ xToY = false (swapping from ETH which is tokenY)
```

### 5. Account Setup Verification
```
Account Check → Verify Associated Token Accounts
├─ ETH (NATIVE_MINT) → Use TOKEN_PROGRAM_ID
├─ USDT/USDC → Use TOKEN_2022_PROGRAM_ID
└─ Custom tokens → Check token registry

Account Creation → Create ATAs if missing
├─ Success → Continue to Simulation
└─ Error → Wrong token program or insufficient SOL
```

### 6. Simulation Phase
```
Simulation → Run swapSimulation()
├─ Status: OK → Continue to execution
├─ Status: Error → Check error type
└─ Exception → Address or parameter error

Common Simulation Errors:
├─ Insufficient liquidity → Reduce swap amount
├─ Price impact too high → Increase slippage tolerance
├─ Pool address error → Verify fee tier matches pool
└─ Amount too small → Increase swap amount
```

### 7. Execution Phase
```
Execution → Call market.swap()
├─ Success → Transaction hash returned
├─ Simulation mismatch → Recalculate with fresh simulation
├─ Account error → Verify ATA addresses
└─ Network error → Retry with backoff
```

## 🚨 Common Error Patterns

### "Account does not exist or has no data"
```
Cause Analysis:
├─ Generated pool address ≠ actual pool address
├─ Using arbitrary fee tiers instead of real ones
└─ Wrong token order in Pair constructor

Solution Path:
1. Get actual pools: market.getAllPools()
2. Filter for your token pair
3. Use exact fee values from real pools
4. Verify token order (lexicographic sorting)
```

### "Pool doesn't exist for this pair"
```
Diagnosis Steps:
1. Check total pools: console.log(pools.length)
2. Filter for each token individually
3. Check token mint addresses
4. Try alternative pairs

Token Pair Alternatives:
├─ ETH/USDT → ETH/USDC
├─ Direct pair → Multi-hop routing
└─ Different fee tiers → Lower/higher fees
```

### Simulation Failures
```
Error Types:
├─ SlippageExceeded → Increase slippage tolerance
├─ InsufficientLiquidity → Reduce amount or different pool
├─ PriceImpactTooHigh → Smaller swap size
└─ InvalidTick → Check tick spacing parameters

Progressive Fixes:
1. Try slippage: 0% → 0.1% → 0.5% → 1%
2. Try amounts: 40% → 20% → 10% → 5% of balance
3. Try pools: lowest fee → higher fees
```

## 🔧 Diagnostic Commands

### Pool Analysis Script
```typescript
async function diagnoseMarket(market: Market) {
  const pools = await market.getAllPools();
  console.log(`📊 Total pools: ${pools.length}`);
  
  // ETH pool analysis
  const ethPools = pools.filter(p => p.tokenX.equals(ETH_MINT) || p.tokenY.equals(ETH_MINT));
  console.log(`🔹 ETH pools: ${ethPools.length}`);
  
  // USDT/USDC analysis  
  const stablePools = pools.filter(p => 
    p.tokenX.equals(USDT_MINT) || p.tokenY.equals(USDT_MINT) ||
    p.tokenX.equals(USDC_MINT) || p.tokenY.equals(USDC_MINT)
  );
  console.log(`💵 Stable coin pools: ${stablePools.length}`);
  
  // Fee distribution
  const feeGroups = ethPools.reduce((acc, pool) => {
    const feeStr = pool.fee.toString();
    acc[feeStr] = (acc[feeStr] || 0) + 1;
    return acc;
  }, {});
  console.log(`📈 Fee distribution:`, feeGroups);
}
```

### Balance Verification
```typescript
async function checkAllBalances() {
  // Native SOL
  const solBalance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 SOL: ${solBalance / LAMPORTS_PER_SOL}`);
  
  // Wrapped SOL  
  const wrappedSol = await getAvailableWrappedSolBalance();
  console.log(`🔄 Wrapped SOL: ${wrappedSol.toString()}`);
  
  // Token balances
  for (const [name, mint] of [["USDT", USDT_MINT], ["USDC", USDC_MINT]]) {
    try {
      const account = await getAccount(connection, getAssociatedTokenAddressSync(mint, keypair.publicKey, true, getTokenProgram(mint)), "confirmed", getTokenProgram(mint));
      console.log(`💵 ${name}: ${account.amount}`);
    } catch {
      console.log(`💵 ${name}: No account`);
    }
  }
}
```

### Network Health Check
```typescript
async function checkNetworkHealth() {
  const start = Date.now();
  try {
    const slot = await connection.getSlot();
    const latency = Date.now() - start;
    console.log(`🌐 Network: OK (${latency}ms), Slot: ${slot}`);
  } catch (error) {
    console.log(`🚨 Network: Error -`, error.message);
  }
}
```

## 🎯 Success Checklist

Before executing swaps, verify:
- [ ] ✅ Market connected (total pools > 0)
- [ ] ✅ Token pair pools exist (filtered pools > 0)  
- [ ] ✅ Using actual fee values from pools
- [ ] ✅ Correct token programs for ATAs
- [ ] ✅ Sufficient wrapped SOL balance
- [ ] ✅ Simulation status = OK
- [ ] ✅ Reasonable slippage tolerance
- [ ] ✅ Amount within liquidity limits

## 🔄 Recovery Strategies

### When Everything Fails
1. **Start Fresh**: New wallet, minimal amount
2. **Simplify**: Use only ETH/USDC with lowest fee tier
3. **Debug Mode**: Add extensive logging to each step
4. **Alternative SDK**: Try different version or approach
5. **Manual Verification**: Check pools on Eclipse explorer

### Gradual Scaling
1. **Proof of Concept**: Small amount, single pool
2. **Add Robustness**: Multiple pools, error handling
3. **Scale Amount**: Increase swap size gradually
4. **Add Features**: Multiple pairs, slippage management
5. **Production Ready**: Full error handling, monitoring

Remember: Most issues stem from using theoretical values instead of actual on-chain data. Always start with real pool discovery!
