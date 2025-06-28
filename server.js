const express = require('express');
const cors = require('cors');
const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} = require('@solana/web3.js');

const {
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAssociatedTokenAddress,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
} = require('@solana/spl-token');

const { Market, Network, Pair } = require('@invariant-labs/sdk-eclipse');
const BN = require('bn.js');
const {
  SimulationStatus,
  swapSimulation,
  toDecimal,
} = require('@invariant-labs/sdk-eclipse/lib/utils');

const base58 = require('bs58');
require('dotenv').config();

// Constants
const TICK_CROSSES_PER_IX_NATIVE_TOKEN = 40;
const ECLIPSE_RPC_URL = "https://mainnetbeta-rpc.eclipse.xyz";
const INVARIANT_PROGRAM_ID = "iNvTyprs4TX8m6UeUEkeqDFjAL9zRCRWcexK9Sd4WEU";

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Global connection
const connection = new Connection(ECLIPSE_RPC_URL, "confirmed");

// Token Registry - Extended list of Eclipse tokens
const TOKEN_REGISTRY = {
  // Native tokens
  ETH: {
    mint: NATIVE_MINT,
    symbol: "ETH",
    name: "Ethereum (Native SOL)",
    decimals: 9,
    tokenProgram: TOKEN_PROGRAM_ID,
  },
  SOL: {
    mint: NATIVE_MINT,
    symbol: "SOL", 
    name: "Solana",
    decimals: 9,
    tokenProgram: TOKEN_PROGRAM_ID,
  },
  
  // Stablecoins
  USDT: {
    mint: new PublicKey("CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm"),
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  },
  USDC: {
    mint: new PublicKey("AKEWE7Bgh87GPp171b4cJPSSZfmZwQ3KaqYqXoKLNAEE"),
    symbol: "USDC", 
    name: "USD Coin",
    decimals: 6,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  },
  
  // Additional Eclipse tokens (add more as available)
  WBTC: {
    mint: new PublicKey("9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E"), // Example address
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  },
  
  // More tokens that might be available on Eclipse
  WETH: {
    mint: new PublicKey("So11111111111111111111111111111111111111112"), // Using native mint as placeholder
    symbol: "WETH",
    name: "Wrapped Ethereum", 
    decimals: 9,
    tokenProgram: TOKEN_PROGRAM_ID,
  },
  
  // Add placeholder entries for other common tokens
  // Note: Update these addresses when they become available on Eclipse
  AVAX: {
    mint: new PublicKey("KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS"), // Placeholder
    symbol: "AVAX",
    name: "Avalanche",
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  },
  
  MATIC: {
    mint: new PublicKey("Ga2AXHpfAF6mv2ekZwcsJFqu7wB4NV331qNH7fW9Nst8"), // Placeholder
    symbol: "MATIC", 
    name: "Polygon",
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  },
  
  // Add more tokens here as they become available on Eclipse
};

// Utility Functions
function getTokenInfo(symbol) {
  const token = TOKEN_REGISTRY[symbol.toUpperCase()];
  if (!token) {
    throw new Error(`Token ${symbol} not supported`);
  }
  return token;
}

function createKeypairFromPrivateKey(privateKey) {
  try {
    const secretKeyBase58 = base58.decode(privateKey);
    return Keypair.fromSecretKey(secretKeyBase58);
  } catch (error) {
    throw new Error('Invalid private key format');
  }
}

async function initializeMarket() {
  try {
    // Create a temporary keypair for market initialization (read-only operations)
    const tempKeypair = Keypair.generate();
    
    const market = await Market.build(
      Network.MAIN,
      tempKeypair,
      connection,
      new PublicKey(INVARIANT_PROGRAM_ID)
    );
    
    return market;
  } catch (error) {
    console.error('Failed to initialize market:', error);
    throw new Error('Market initialization failed');
  }
}

async function getAvailableTokenBalance(mint, owner, tokenProgram) {
  try {
    const associatedTokenAddress = getAssociatedTokenAddressSync(
      mint,
      owner,
      true,
      tokenProgram
    );

    const account = await getAccount(
      connection,
      associatedTokenAddress,
      "confirmed",
      tokenProgram
    );
    
    return new BN(account.amount.toString());
  } catch (error) {
    return new BN(0);
  }
}

async function createTokenAccountIfNeeded(mint, owner, keypair, tokenProgram) {
  const associatedTokenAddress = getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    tokenProgram
  );

  try {
    await getAccount(connection, associatedTokenAddress, "confirmed", tokenProgram);
    return associatedTokenAddress;
  } catch (error) {
    // Create the account
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        associatedTokenAddress,
        keypair.publicKey,
        mint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [keypair]);
    return associatedTokenAddress;
  }
}

async function findBestPoolForPair(market, tokenA, tokenB) {
  const allPools = await market.getAllPools();
  
  // Filter pools for the token pair
  const relevantPools = allPools.filter(pool =>
    (pool.tokenX.equals(tokenA) && pool.tokenY.equals(tokenB)) ||
    (pool.tokenX.equals(tokenB) && pool.tokenY.equals(tokenA))
  );
  
  // Sort by fee (lower fees first, usually more liquid)
  relevantPools.sort((a, b) => a.fee.cmp(b.fee));
  
  return relevantPools;
}

async function performTokenSwap(fromToken, toToken, amount, slippagePercent, privateKey) {
  const keypair = createKeypairFromPrivateKey(privateKey);
  const market = await initializeMarket();
  
  // Get token info
  const fromTokenInfo = getTokenInfo(fromToken);
  const toTokenInfo = getTokenInfo(toToken);
  
  // Convert amount to appropriate units
  const swapAmount = new BN(amount).mul(new BN(10).pow(new BN(fromTokenInfo.decimals)));
  
  // Find available pools
  const pools = await findBestPoolForPair(market, fromTokenInfo.mint, toTokenInfo.mint);
  
  if (pools.length === 0) {
    throw new Error(`No liquidity pools found for ${fromToken}/${toToken} pair`);
  }
  
  // Create token accounts if needed
  await createTokenAccountIfNeeded(fromTokenInfo.mint, keypair.publicKey, keypair, fromTokenInfo.tokenProgram);
  await createTokenAccountIfNeeded(toTokenInfo.mint, keypair.publicKey, keypair, toTokenInfo.tokenProgram);
  
  // Try each pool until one works
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    
    try {
      // Create pair with actual pool parameters
      const feeTier = {
        fee: pool.fee,
        tickSpacing: pool.tickSpacing || 1
      };
      
      const pair = new Pair(pool.tokenX, pool.tokenY, feeTier);
      const xToY = pair.tokenX.equals(fromTokenInfo.mint);
      
      // Get token accounts
      const accountX = getAssociatedTokenAddressSync(
        pair.tokenX,
        keypair.publicKey,
        true,
        pair.tokenX.equals(fromTokenInfo.mint) ? fromTokenInfo.tokenProgram : toTokenInfo.tokenProgram
      );
      
      const accountY = getAssociatedTokenAddressSync(
        pair.tokenY,
        keypair.publicKey,
        true,
        pair.tokenY.equals(fromTokenInfo.mint) ? fromTokenInfo.tokenProgram : toTokenInfo.tokenProgram
      );
      
      // Simulate swap
      const poolAddress = pair.getAddress(market.program.programId);
      const slippage = toDecimal(slippagePercent, 2); // Convert percentage to decimal
      
      const simulation = await swapSimulation(
        xToY,
        true, // byAmountIn
        swapAmount,
        undefined,
        slippage,
        market,
        poolAddress,
        TICK_CROSSES_PER_IX_NATIVE_TOKEN
      );
      
      if (simulation.status !== SimulationStatus.Ok) {
        console.log(`Pool ${i + 1} simulation failed: ${simulation.status}`);
        continue;
      }
      
      // Execute swap
      const txHash = await market.swap({
        xToY,
        estimatedPriceAfterSwap: simulation.priceAfterSwap,
        pair,
        amount: swapAmount,
        slippage,
        byAmountIn: true,
        accountX,
        accountY,
        owner: keypair.publicKey
      }, keypair);
      
      return {
        success: true,
        transactionHash: txHash,
        fromToken,
        toToken,
        fromAmount: amount,
        estimatedToAmount: simulation.accumulatedAmountOut ? 
          simulation.accumulatedAmountOut.div(new BN(10).pow(new BN(toTokenInfo.decimals))).toString() : 
          'Unknown',
        poolUsed: {
          address: poolAddress.toString(),
          fee: pool.fee.toString(),
          feePercent: (pool.fee.toNumber() / 1000000000).toFixed(4) + '%'
        }
      };
      
    } catch (error) {
      console.log(`Pool ${i + 1} failed:`, error.message);
      continue;
    }
  }
  
  throw new Error('All available pools failed for this swap');
}

// API Routes

// Get supported tokens
app.get('/api/tokens', (req, res) => {
  const tokens = Object.entries(TOKEN_REGISTRY).map(([symbol, info]) => ({
    symbol,
    name: info.name,
    mint: info.mint.toString(),
    decimals: info.decimals
  }));
  
  res.json({
    success: true,
    tokens
  });
});

// Get available pools for a token pair
app.get('/api/pools/:fromToken/:toToken', async (req, res) => {
  try {
    const { fromToken, toToken } = req.params;
    
    const fromTokenInfo = getTokenInfo(fromToken);
    const toTokenInfo = getTokenInfo(toToken);
    
    const market = await initializeMarket();
    const pools = await findBestPoolForPair(market, fromTokenInfo.mint, toTokenInfo.mint);
    
    const poolData = pools.map(pool => ({
      tokenX: pool.tokenX.toString(),
      tokenY: pool.tokenY.toString(),
      fee: pool.fee.toString(),
      feePercent: (pool.fee.toNumber() / 1000000000).toFixed(4) + '%',
      tickSpacing: pool.tickSpacing
    }));
    
    res.json({
      success: true,
      pair: `${fromToken}/${toToken}`,
      poolsFound: pools.length,
      pools: poolData
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Get token balance
app.post('/api/balance', async (req, res) => {
  try {
    const { token, privateKey } = req.body;
    
    if (!token || !privateKey) {
      return res.status(400).json({
        success: false,
        error: 'Token symbol and private key are required'
      });
    }
    
    const tokenInfo = getTokenInfo(token);
    const keypair = createKeypairFromPrivateKey(privateKey);
    
    let balance;
    if (tokenInfo.mint.equals(NATIVE_MINT)) {
      // Native SOL balance
      const lamports = await connection.getBalance(keypair.publicKey);
      balance = lamports / LAMPORTS_PER_SOL;
    } else {
      // Token balance
      const tokenBalance = await getAvailableTokenBalance(
        tokenInfo.mint,
        keypair.publicKey,
        tokenInfo.tokenProgram
      );
      balance = tokenBalance.div(new BN(10).pow(new BN(tokenInfo.decimals))).toNumber();
    }
    
    res.json({
      success: true,
      token,
      balance,
      wallet: keypair.publicKey.toString()
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Wrap SOL to WSOL
app.post('/api/wrap-sol', async (req, res) => {
  try {
    const { privateKey, amount } = req.body;
    
    if (!privateKey || !amount) {
      return res.status(400).json({
        success: false,
        error: 'privateKey and amount are required'
      });
    }
    
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0'
      });
    }
    
    const keypair = createKeypairFromPrivateKey(privateKey);
    const lamportsToWrap = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
    const balance = await connection.getBalance(keypair.publicKey);
    
    // Check if user has enough SOL (including transaction fees)
    const minBalance = lamportsToWrap + 5000; // 5000 lamports for fees
    if (balance < minBalance) {
      return res.status(400).json({
        success: false,
        error: `Insufficient SOL balance. Need ${minBalance / LAMPORTS_PER_SOL} SOL, but have ${balance / LAMPORTS_PER_SOL} SOL`
      });
    }
    
    // Get or create associated token account for WSOL
    const associatedTokenAccount = await getAssociatedTokenAddress(
      NATIVE_MINT,
      keypair.publicKey
    );
    
    let accountExists = false;
    try {
      await getAccount(connection, associatedTokenAccount, "confirmed", TOKEN_PROGRAM_ID);
      accountExists = true;
    } catch (error) {
      // Account doesn't exist, will create it
    }
    
    const instructions = [];
    
    // Create ATA if it doesn't exist
    if (!accountExists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          keypair.publicKey,
          associatedTokenAccount,
          keypair.publicKey,
          NATIVE_MINT
        )
      );
    }
    
    // Transfer SOL to the token account
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: associatedTokenAccount,
        lamports: lamportsToWrap,
      })
    );
    
    // Sync native instruction to make it WSOL
    instructions.push(
      createSyncNativeInstruction(associatedTokenAccount)
    );
    
    const transaction = new Transaction().add(...instructions);
    const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);
    
    res.json({
      success: true,
      signature,
      wrappedAmount: lamportsToWrap,
      wrappedAmountSol: lamportsToWrap / LAMPORTS_PER_SOL,
      tokenAccount: associatedTokenAccount.toString()
    });
    
  } catch (error) {
    console.error('Wrap SOL error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wallet info (all balances)
app.post('/api/wallet/info', async (req, res) => {
  try {
    const { privateKey } = req.body;
    
    if (!privateKey) {
      return res.status(400).json({
        success: false,
        error: 'privateKey is required'
      });
    }
    
    const keypair = createKeypairFromPrivateKey(privateKey);
    const walletAddress = keypair.publicKey.toString();
    
    // Get SOL balance
    const solBalance = await connection.getBalance(keypair.publicKey);
    
    // Get all token balances
    const tokenBalances = {};
    for (const [symbol, tokenInfo] of Object.entries(TOKEN_REGISTRY)) {
      try {
        if (tokenInfo.mint.equals(NATIVE_MINT)) {
          tokenBalances[symbol] = {
            balance: solBalance / LAMPORTS_PER_SOL,
            decimals: tokenInfo.decimals,
            mint: tokenInfo.mint.toString()
          };
        } else {
          const balance = await getAvailableTokenBalance(
            tokenInfo.mint,
            keypair.publicKey,
            tokenInfo.tokenProgram
          );
          const humanBalance = balance.div(new BN(10).pow(new BN(tokenInfo.decimals))).toNumber();
          
          if (humanBalance > 0) {
            tokenBalances[symbol] = {
              balance: humanBalance,
              decimals: tokenInfo.decimals,
              mint: tokenInfo.mint.toString()
            };
          }
        }
      } catch (error) {
        // Token account doesn't exist or other error, skip
      }
    }
    
    res.json({
      success: true,
      wallet: walletAddress,
      solBalance: solBalance / LAMPORTS_PER_SOL,
      tokenBalances
    });
    
  } catch (error) {
    console.error('Wallet info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available pools for all tokens
app.get('/api/pools/all', async (req, res) => {
  try {
    const market = await initializeMarket();
    const allPools = await market.getAllPools();
    
    const poolsData = allPools.map(pool => ({
      tokenX: pool.tokenX.toString(),
      tokenY: pool.tokenY.toString(),
      fee: pool.fee.toString(),
      tickSpacing: pool.tickSpacing,
      feePercent: (pool.fee.toNumber() / 1000000000).toFixed(6) + '%',
      // Try to resolve token symbols
      tokenXSymbol: Object.entries(TOKEN_REGISTRY).find(([,token]) => 
        token.mint.equals(pool.tokenX))?.[0] || 'UNKNOWN',
      tokenYSymbol: Object.entries(TOKEN_REGISTRY).find(([,token]) => 
        token.mint.equals(pool.tokenY))?.[0] || 'UNKNOWN',
    }));
    
    res.json({
      success: true,
      totalPools: allPools.length,
      pools: poolsData
    });
    
  } catch (error) {
    console.error('Get all pools error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get pool price and liquidity info
app.get('/api/pool/:tokenA/:tokenB/info', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    
    const tokenAInfo = getTokenInfo(tokenA);
    const tokenBInfo = getTokenInfo(tokenB);
    
    const market = await initializeMarket();
    const pools = await findPoolForTokenPair(
      market, 
      tokenAInfo.mint, 
      tokenBInfo.mint
    );
    
    if (!pools || pools.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No pools found for ${tokenA}/${tokenB}`
      });
    }
    
    const poolInfo = pools.map(pool => ({
      tokenX: pool.tokenX.toString(),
      tokenY: pool.tokenY.toString(),
      fee: pool.fee.toString(),
      feePercent: (pool.fee.toNumber() / 1000000000).toFixed(6) + '%',
      tickSpacing: pool.tickSpacing,
      // Additional pool data would go here if available from the SDK
    }));
    
    res.json({
      success: true,
      tokenA,
      tokenB,
      pools: poolInfo
    });
    
  } catch (error) {
    console.error('Pool info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Perform token swap
app.post('/api/swap', async (req, res) => {
  try {
    const { fromToken, toToken, amount, slippage = 0.5, privateKey } = req.body;
    
    // Validation
    if (!fromToken || !toToken || !amount || !privateKey) {
      return res.status(400).json({
        success: false,
        error: 'fromToken, toToken, amount, and privateKey are required'
      });
    }
    
    if (fromToken.toUpperCase() === toToken.toUpperCase()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot swap the same token'
      });
    }
    
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0'
      });
    }
    
    if (slippage < 0 || slippage > 50) {
      return res.status(400).json({
        success: false,
        error: 'Slippage must be between 0 and 50 percent'
      });
    }
    
    // Perform the swap
    const result = await performTokenSwap(fromToken, toToken, amount, slippage, privateKey);
    
    res.json(result);
    
  } catch (error) {
    console.error('Swap error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get market statistics
app.get('/api/market/stats', async (req, res) => {
  try {
    const market = await initializeMarket();
    const allPools = await market.getAllPools();
    
    // Count pools by token
    const tokenStats = {};
    allPools.forEach(pool => {
      const tokenX = pool.tokenX.toString();
      const tokenY = pool.tokenY.toString();
      
      tokenStats[tokenX] = (tokenStats[tokenX] || 0) + 1;
      tokenStats[tokenY] = (tokenStats[tokenY] || 0) + 1;
    });
    
    // Find which registered tokens have pools
    const registeredTokensWithPools = {};
    Object.entries(TOKEN_REGISTRY).forEach(([symbol, info]) => {
      const mint = info.mint.toString();
      if (tokenStats[mint]) {
        registeredTokensWithPools[symbol] = tokenStats[mint];
      }
    });
    
    res.json({
      success: true,
      totalPools: allPools.length,
      registeredTokensWithPools,
      allTokenStats: tokenStats
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const slot = await connection.getSlot();
    res.json({
      success: true,
      status: 'healthy',
      network: 'Eclipse Mainnet',
      currentSlot: slot,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Get swap quote (simulation only)
app.post('/api/quote', async (req, res) => {
  try {
    const { fromToken, toToken, amount, slippage = 0.5 } = req.body;
    
    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        success: false,
        error: 'fromToken, toToken, and amount are required'
      });
    }
    
    const fromTokenInfo = getTokenInfo(fromToken);
    const toTokenInfo = getTokenInfo(toToken);
    const swapAmount = new BN(amount).mul(new BN(10).pow(new BN(fromTokenInfo.decimals)));
    
    const market = await initializeMarket();
    const pools = await findBestPoolForPair(market, fromTokenInfo.mint, toTokenInfo.mint);
    
    if (pools.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No liquidity pools found for ${fromToken}/${toToken} pair`
      });
    }
    
    // Get quote from the best pool
    const pool = pools[0]; // Use the pool with lowest fee
    const feeTier = { fee: pool.fee, tickSpacing: pool.tickSpacing || 1 };
    const pair = new Pair(pool.tokenX, pool.tokenY, feeTier);
    const xToY = pair.tokenX.equals(fromTokenInfo.mint);
    
    const poolAddress = pair.getAddress(market.program.programId);
    const slippageDecimal = toDecimal(slippage, 2);
    
    const simulation = await swapSimulation(
      xToY,
      true,
      swapAmount,
      undefined,
      slippageDecimal,
      market,
      poolAddress,
      TICK_CROSSES_PER_IX_NATIVE_TOKEN
    );
    
    if (simulation.status !== SimulationStatus.Ok) {
      return res.status(400).json({
        success: false,
        error: `Simulation failed: ${simulation.status}`
      });
    }
    
    const outputAmount = simulation.accumulatedAmountOut
      .div(new BN(10).pow(new BN(toTokenInfo.decimals)))
      .toString();
    
    res.json({
      success: true,
      fromToken,
      toToken,
      fromAmount: amount,
      estimatedToAmount: outputAmount,
      priceImpact: simulation.priceImpact ? simulation.priceImpact.toString() : 'N/A',
      fee: (pool.fee.toNumber() / 1000000000).toFixed(4) + '%',
      slippage: slippage + '%'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Invariant Eclipse Swap Server running on port ${PORT}`);
  console.log(`\n� Available API endpoints:`);
  console.log(`   GET  /api/health                    - Server health check`);
  console.log(`   GET  /api/tokens                    - List supported tokens`);
  console.log(`   GET  /api/pools/:tokenA/:tokenB     - Find pools for token pair`);
  console.log(`   GET  /api/pools/all                 - List all available pools`);
  console.log(`   GET  /api/pool/:tokenA/:tokenB/info - Detailed pool information`);
  console.log(`   GET  /api/market/stats              - Market statistics`);
  console.log(`   POST /api/balance                   - Get token balance`);
  console.log(`   POST /api/wallet/info               - Get all wallet balances`);
  console.log(`   POST /api/wrap-sol                  - Wrap SOL to WSOL`);
  console.log(`   POST /api/quote                     - Get swap quote`);
  console.log(`   POST /api/swap                      - Execute token swap`);
  console.log(`\n🔄 Ready to handle requests for ${Object.keys(TOKEN_REGISTRY).length} tokens!`);
  console.log(`💡 Example: POST /api/swap with {fromToken: "ETH", toToken: "USDT", amount: 0.1, privateKey: "..."}`);
});

module.exports = app;
