import express, { Request, Response, NextFunction } from 'express';
import {  createAssociatedTokenAccount, getAvailableWrappedSolBalance } from './app';
import { FEE_TIER, Market, Network, Pair } from "@invariant-labs/sdk-eclipse";
import cors from 'cors';
import { json, urlencoded } from 'express';
import { Connection, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import { createAssociatedTokenAccountInstruction, createSyncNativeInstruction, getAccount, getAssociatedTokenAddress, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
//import { deserializeSwapSDK } from '@deserialize/swap-sdk-eclipse';

//const sdk = new deserializeSwapSDK();


// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;
// Eclipse mainnet RPC endpoint
const ECLIPSE_RPC_URL = "https://mainnetbeta-rpc.eclipse.xyz";
const connection = new Connection(ECLIPSE_RPC_URL, "confirmed");

async function wrapSol(amountInSol: number, publicKey: PublicKey): Promise<{ associatedTokenAccount: PublicKey; lamportsToWrap: number; }> {
  const lamportsToWrap = Math.floor(amountInSol * LAMPORTS_PER_SOL);

  // Check if we have enough balance
  const balance = await connection.getBalance(publicKey)
  if (balance < lamportsToWrap + 5000) {
    // Reserve 5000 lamports for transaction fees
    throw new Error(
      `Insufficient balance. Need ${
        (lamportsToWrap + 5000) / LAMPORTS_PER_SOL
      } SOL, but only have ${balance / LAMPORTS_PER_SOL} SOL`
    );
  }

  const associatedTokenAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    publicKey
  );

  console.log(
    `Wrapping ${amountInSol} SOL (${lamportsToWrap} lamports) into WSOL...`
  );
  console.log(`WSOL account: ${associatedTokenAccount.toBase58()}`);

  // Check if the associated token account already exists
  let accountExists = false;
  try {
    await getAccount(
      connection,
      associatedTokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    accountExists = true;
    console.log("WSOL account already exists");
  } catch (error) {
    console.log("WSOL account doesn't exist, will create it");
  }

  const instructions = [];

  // Add create account instruction if needed
  if (!accountExists) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        publicKey,
        associatedTokenAccount,
        publicKey,
        NATIVE_MINT
      )
    );
  }

  // Add transfer and sync instructions
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: associatedTokenAccount,
      lamports: lamportsToWrap,
    }),
    createSyncNativeInstruction(associatedTokenAccount)
  );

  const wrapTransaction = new Transaction().add(...instructions);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      wrapTransaction,
      [keypair]
    );
    console.log(`SOL wrapped successfully! Transaction: ${signature}`);
    return { associatedTokenAccount, lamportsToWrap};
  } catch (error) {
    console.error("Failed to wrap SOL:", error);
    throw error;
  }
}

// swap function
async function smartSwapEthToUsdt(market: Market, tokenX: string, tokenY: string, amount: number): Promise<void> {
  console.log("\n=== SWAP: ETH TO USDT ===");
  // CONVERT AMOUNT TO LAMPORTS
  amount = wrapSol(amount); // Convert amount to wrapped SOL
  // convert amount to BN
  const amountBN = new BN(amount);
  // Get available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
  if (amountBN < wrappedSolBalance) {
    console.log(`Insufficient wrapped SOL balance: ${wrappedSolBalance.toString()} lamports`);
    return;
  }
  const swapAmount = wrappedSolBalance.muln(40).divn(100); // 40% of balance

  if (swapAmount.eqn(0)) {
    console.log("No wrapped SOL available for swap");
    return;
  }

  console.log(
    `Available wrapped SOL: ${wrappedSolBalance.toString()} lamports`
  );
  console.log(`Swap amount (40%): ${swapAmount.toString()} lamports`);

  // Try different token pairs
  const tokenPairs = [
    { tokenA: ETH_MINT, tokenB: USDT_MINT, name: "ETH/USDT" },
    { tokenA: ETH_MINT, tokenB: USDC_MINT, name: "ETH/USDC" },
  ];

  for (const { tokenA, tokenB, name } of tokenPairs) {
    console.log(`\n--- Trying ${name} ---`);

    try {
      // Get all pools for this token pair with their actual addresses
      const poolsWithAddresses = await getPoolsForTokenPair(
        market,
        tokenA,
        tokenB
      );

      if (poolsWithAddresses.length === 0) {
        console.log(`No pools found for ${name}`);
        continue;
      }

      console.log(`Found ${poolsWithAddresses.length} pools for ${name}`);

      // Try each pool
      for (let i = 0; i < poolsWithAddresses.length; i++) {
        const { pool, address } = poolsWithAddresses[i];
        console.log(`\n  --- Pool ${i + 1}/${poolsWithAddresses.length} ---`);
        console.log(
          `  Pool tokens: ${pool.tokenX.toString()} ↔ ${pool.tokenY.toString()}`
        );
        console.log(
          `  Pool fee: ${pool.fee?.toString()} (${
            (pool.fee?.toNumber() || 0) / 10000000
          }%)`
        );
        console.log(`  Pool address: ${address.toString()}`);

        try {
          // Create pair using the actual pool's fee structure
          const feeTier = {
            fee: pool.fee,
            tickSpacing: pool.tickSpacing || 1,
          };
          const pair = new Pair(pool.tokenX, pool.tokenY, feeTier);

          // Determine swap direction
          const xToY = pair.tokenX.equals(ETH_MINT);
          console.log(`  Swap direction - X to Y: ${xToY}`);

          // Get associated token accounts
          const accountX = getAssociatedTokenAddressSync(
            pair.tokenX,
            keypair.publicKey,
            true,
            pair.tokenX.equals(USDT_MINT) || pair.tokenX.equals(USDC_MINT)
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID
          );

          const accountY = getAssociatedTokenAddressSync(
            pair.tokenY,
            keypair.publicKey,
            true,
            pair.tokenY.equals(USDT_MINT) || pair.tokenY.equals(USDC_MINT)
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID
          );

          // Perform simulation first using the actual pool address
          console.log(" Simulating swap...");
          const slippage = toDecimal(0, 0); // 0% slippage

          const simulation = await swapSimulation(
            xToY,
            true, // byAmountIn
            swapAmount,
            undefined,
            slippage,
            market,
            address, // Use the actual pool address
            TICK_CROSSES_PER_IX_NATIVE_TOKEN
          );

          if (simulation.status !== SimulationStatus.Ok) {
            console.log(`Simulation failed: ${simulation.status}`);
            continue;
          }

          console.log("Simulation successful!");
          console.log(
            `  Estimated price after swap: ${simulation.priceAfterSwap}`
          );

          // Execute the swap
          console.log("Executing swap...");
          const txHash = await market.swap(
            {
              xToY,
              estimatedPriceAfterSwap: simulation.priceAfterSwap,
              pair,
              amount: swapAmount,
              slippage,
              byAmountIn: true,
              accountX,
              accountY,
              owner: keypair.publicKey,
            },
            keypair as any
          );

          console.log("Swap completed successfully!");
          console.log(`Transaction hash: ${txHash}`);
          return; // Exit after successful swap
        } catch (error) {
          console.log(`Error with pool ${i + 1}:`, error);
          if (error instanceof Error) {
            console.log(`  Error message: ${error.message}`);
          }
          continue;
        }
      }
    } catch (error) {
      console.log(`Error processing ${name}:`, error);
      continue;
    }
  }

  console.log("All swap attempts failed - no suitable pools found");
}

// Middleware
app.use(cors());
app.use(json()); 
app.use(urlencoded({ extended: true })); // Parse URL-encoded bodies

// Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'Express server is running'
  });
});


// POST endpoint for trading/swap operations
app.post('/api/swap',async (req: Request, res: Response) => {
  try {
    // take the token address for the swap, will change later to the token name
    const { fromToken, toToken, amount, publicKey} = req.body;
    
    // Validation
    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'fromToken, toToken, and amount are required'
      });
    }
    
    // Simulate swap operation
    const swapResult = {
      transactionId: Math.random().toString(36).substr(2, 16),
      fromToken,
      toToken,
      amountIn: amount,
      estimatedAmountOut: amount * 0.98, // Simulate 2% slippage
      //slippage: slippage || 0.02,
      status: 'pending',
      timestamp: new Date().toISOString()
    };

    res.status(200).json({
      success: true,
      message: 'Swap initiated successfully',
      swap: swapResult
    });
  } catch (error) {
    console.error('Error processing swap:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process swap'
    });
  }
});


// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'Something went wrong'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Express server is running on http://localhost:${PORT}`);
});

export default app;