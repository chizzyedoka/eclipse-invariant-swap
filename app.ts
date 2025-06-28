import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";

import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_2022_PROGRAM_ID, // Ensure correct program ID for your tokens
  getAssociatedTokenAddressSync,
  getAssociatedTokenAddress,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSyncNativeInstruction, // Represents wrapped SOL (native currency)
} from "@solana/spl-token";

import { FEE_TIER, Market, Network, Pair } from "@invariant-labs/sdk-eclipse";
import BN from "bn.js";

const TICK_CROSSES_PER_IX_NATIVE_TOKEN = 40;
const TICK_VIRTUAL_CROSSES_PER_IX = 20;

// load .env file
import dotenv from "dotenv";
import base58 from "bs58";
import {
  SimulationStatus,
  swapSimulation,
  toDecimal,
} from "@invariant-labs/sdk-eclipse/lib/utils";
dotenv.config();

// Ensure WALLET_PRIVATE_KEY is set in your .env file
const secret_key = process.env.WALLET_PRIVATE_KEY;
if (!secret_key) {
  throw new Error("WALLET_PRIVATE_KEY not found in .env file");
}

// convert secret key to base58
const secretKeyBase58 = base58.decode(secret_key);
const keypair = Keypair.fromSecretKey(secretKeyBase58);

// Eclipse mainnet RPC endpoint
const ECLIPSE_RPC_URL = "https://mainnetbeta-rpc.eclipse.xyz";

// Token addresses on Eclipse
// NATIVE_MINT is the PublicKey for wrapped SOL (So111...1112),
// which is referred to as "ETH" in the documentation for native token swaps.
const ETH_MINT = NATIVE_MINT;

// USDT_MINT should be the actual USDT token address on Eclipse
const USDT_MINT = new PublicKey("CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm"); // USDT

// USDC_MINT should be the actual USDC token address on Eclipse
const USDC_MINT = new PublicKey("AKEWE7Bgh87GPp171b4cJPSSZfmZwQ3KaqYqXoKLNAEE"); // USDC

const connection = new Connection(ECLIPSE_RPC_URL, "confirmed");

// Function to create an associated token account for a given mint
async function createAssociatedTokenAccount(mint: PublicKey) {
  // Determine which token program to use based on the mint
  const tokenProgram =
    mint.equals(USDT_MINT) || mint.equals(USDC_MINT)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const associatedTokenAddress = getAssociatedTokenAddressSync(
    mint,
    keypair.publicKey,
    true, // allow owner off curve
    tokenProgram // Use the correct token program
  );

  console.log(`Checking associated token account for ${mint.toBase58()}...`);
  console.log(`Associated token address: ${associatedTokenAddress.toBase58()}`);

  try {
    await getAccount(
      connection,
      associatedTokenAddress,
      "confirmed",
      tokenProgram
    );
    console.log(
      `Associated token account already exists: ${associatedTokenAddress.toBase58()}`
    );
  } catch (error) {
    console.log(`Creating associated token account for ${mint.toBase58()}...`);
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        associatedTokenAddress,
        keypair.publicKey,
        mint,
        tokenProgram, // Use the correct token program
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
      keypair,
    ]);
    console.log(`Transaction successful: ${signature}`);
  }
}

//  checkTokenBalance function
async function checkTokenBalance(mint: PublicKey) {
  // Use the correct token program
  const tokenProgram =
    mint.equals(USDT_MINT) || mint.equals(USDC_MINT)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const associatedTokenAddress = getAssociatedTokenAddressSync(
    mint,
    keypair.publicKey,
    true, // allow owner off curve
    tokenProgram
  );

  try {
    const account = await getAccount(
      connection,
      associatedTokenAddress,
      "confirmed",
      tokenProgram
    );
    console.log(`Token balance for ${mint.toBase58()}: ${account.amount}`);
  } catch (error) {
    console.error(
      `Error fetching token balance for ${mint.toBase58()}:`,
      error
    );
  }
}

// check balance of the wallet
async function checkBalance() {
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} ETH`);
}

// Function to wrap SOL into wrapped SOL (WSOL) tokens
async function wrapSol(amountInSol: number): Promise<PublicKey> {
  const lamportsToWrap = amountInSol * LAMPORTS_PER_SOL;

  // Check if we have enough balance
  const balance = await connection.getBalance(keypair.publicKey);
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
    keypair.publicKey
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
        keypair.publicKey,
        associatedTokenAccount,
        keypair.publicKey,
        NATIVE_MINT
      )
    );
  }

  // Add transfer and sync instructions
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
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
    return associatedTokenAccount;
  } catch (error) {
    console.error("Failed to wrap SOL:", error);
    throw error;
  }
}

// Initialize Invariant Market
async function initializeInvariantMarket(): Promise<Market> {
  const market = await Market.build(
    Network.MAIN as any, // Use string instead of Network enum
    keypair as any, // Use keypair directly
    connection,
    new PublicKey("iNvTyprs4TX8m6UeUEkeqDFjAL9zRCRWcexK9Sd4WEU") // Invariant program ID on Eclipse
  );

  console.log("Invariant market initialized");
  return market;
}

// Get available wrapped SOL balance for trading
async function getAvailableWrappedSolBalance(): Promise<BN> {
  const tokenProgram = TOKEN_PROGRAM_ID; // ETH_MINT uses TOKEN_PROGRAM_ID
  const associatedTokenAddress = getAssociatedTokenAddressSync(
    ETH_MINT,
    keypair.publicKey,
    true,
    tokenProgram
  );

  try {
    const account = await getAccount(
      connection,
      associatedTokenAddress,
      "confirmed",
      tokenProgram
    );
    return new BN(account.amount.toString());
  } catch (error) {
    console.error("Error getting wrapped SOL balance:", error);
    return new BN(0);
  }
}

// Check if a pool exists for the given pair
async function checkPoolExists(market: Market, pair: Pair): Promise<boolean> {
  try {
    const pools = await market.getAllPools();
    console.log(`Found ${pools.length} pools on the market`);

    // Check if our pair exists in the pools
    const poolExists = pools.some(
      (pool) =>
        (pool.tokenX.equals(pair.tokenX) && pool.tokenY.equals(pair.tokenY)) ||
        (pool.tokenX.equals(pair.tokenY) && pool.tokenY.equals(pair.tokenX))
    );

    if (poolExists) {
      console.log("Pool exists for this trading pair");
    } else {
      console.log("No pool found for this trading pair");
      // Log available pools
      // console.log("Available pools:");
      // pools.forEach((pool, index) => {
      //   console.log(
      //     `  ${
      //       index + 1
      //     }: ${pool.tokenX.toString()} <-> ${pool.tokenY.toString()}`
      //   );
      // });
    }

    return poolExists;
  } catch (error) {
    console.error("Error checking pools:", error);
    return false;
  }
}

// Perform ETH to USDT swap using Invariant
async function swapEthToUsdt(market: Market): Promise<void> {
  console.log("\n--- Starting ETH to USDT Swap ---");

  // Get 40% of available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
  const swapAmount = wrappedSolBalance.muln(40).divn(100); // 40% of balance

  if (swapAmount.eqn(0)) {
    console.log("❌ No wrapped SOL available for swap");
    return;
  }

  console.log(
    `Available wrapped SOL: ${wrappedSolBalance.toString()} lamports`
  );
  console.log(`Swap amount (40%): ${swapAmount.toString()} lamports`);

  try {
    // Create pair for ETH/USDT
    const feeTier = {
      fee: new BN(1000), // 0.1% fee (1000 = 0.1%)
      tickSpacing: 1, // Standard tick spacing as number
    };
    const pair = new Pair(ETH_MINT, USDT_MINT, feeTier);
    console.log(
      `Trading pair: ${pair.tokenX.toString()} -> ${pair.tokenY.toString()}`
    );

    // Check if pool exists before attempting swap
    const poolExists = await checkPoolExists(market, pair);
    if (!poolExists) {
      console.log(
        "Cannot proceed with swap - pool doesn't exist for this pair"
      );
      console.log("Try using a different token pair or create a pool first");
      return;
    }

    // Determine swap direction (true = X to Y, false = Y to X)
    const xToY = pair.tokenX.equals(ETH_MINT);
    console.log(`Swap direction - X to Y: ${xToY}`);

    // Get associated token accounts
    const accountX = getAssociatedTokenAddressSync(
      pair.tokenX,
      keypair.publicKey,
      true,
      pair.tokenX.equals(USDT_MINT) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );

    const accountY = getAssociatedTokenAddressSync(
      pair.tokenY,
      keypair.publicKey,
      true,
      pair.tokenY.equals(USDT_MINT) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );

    console.log(
      `Account X (${pair.tokenX.toString()}): ${accountX.toString()}`
    );
    console.log(
      `Account Y (${pair.tokenY.toString()}): ${accountY.toString()}`
    );

    // Perform the swap
    const slippage = toDecimal(0, 0); // 0% slippage (1000 = 1%)

    // perform simulation first
    const simulation = await swapSimulation(
      false, // xToY
      true,
      swapAmount,
      undefined,
      slippage,
      market,
      pair.getAddress(market.program.programId),
      TICK_CROSSES_PER_IX_NATIVE_TOKEN
    );
    if (simulation.status !== SimulationStatus.Ok) {
      throw new Error(`Simulation failed: ${simulation.status}`);
    } else {
      console.log("Simulation successful!");
      console.log(`Estimated price after swap: ${simulation.priceAfterSwap}`);
    }

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
        owner: keypair.publicKey, // Add required field
      },
      keypair as any
    );

    console.log("Swap completed successfully!");
    console.log(`Transaction hash: ${txHash}`);
  } catch (error) {
    console.error("❌ Swap failed:", error);
    // Log more details about the error
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
}

// Alternative swap function using ETH/USDC pair
async function swapEthToUsdc(market: Market): Promise<void> {
  console.log("\n--- Starting ETH to USDC Swap ---");

  // Get 40% of available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
  const swapAmount = wrappedSolBalance.muln(40).divn(100); // 40% of balance

  if (swapAmount.eqn(0)) {
    console.log("❌ No wrapped SOL available for swap");
    return;
  }

  console.log(
    `Available wrapped SOL: ${wrappedSolBalance.toString()} lamports`
  );
  console.log(`Swap amount (40%): ${swapAmount.toString()} lamports`);

  try {
    // Create pair for ETH/USDC (more likely to have liquidity)
    const feeTier = {
      fee: new BN(1000), // 0.1% fee (1000 = 0.1%)
      tickSpacing: 1, // Standard tick spacing as number
    };
    const pair = new Pair(ETH_MINT, USDC_MINT, feeTier);
    console.log(
      `Trading pair: ${pair.tokenX.toString()} -> ${pair.tokenY.toString()}`
    );

    // Check if pool exists before attempting swap
    const poolExists = await checkPoolExists(market, pair);
    if (!poolExists) {
      console.log(
        "❌ Cannot proceed with swap - pool doesn't exist for this pair"
      );
      console.log("💡 Try using a different token pair or create a pool first");
      return;
    }

    // Determine swap direction (true = X to Y, false = Y to X)
    const xToY = pair.tokenX.equals(ETH_MINT);
    console.log(`Swap direction - X to Y: ${xToY}`);

    // Get associated token accounts
    const accountX = getAssociatedTokenAddressSync(
      pair.tokenX,
      keypair.publicKey,
      true,
      pair.tokenX.equals(USDC_MINT) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );

    const accountY = getAssociatedTokenAddressSync(
      pair.tokenY,
      keypair.publicKey,
      true,
      pair.tokenY.equals(USDC_MINT) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    );

    console.log(
      `Account X (${pair.tokenX.toString()}): ${accountX.toString()}`
    );
    console.log(
      `Account Y (${pair.tokenY.toString()}): ${accountY.toString()}`
    );

    // Perform the swap
    const slippage = new BN(500); // 0.05% slippage (1000 = 1%)

    console.log("🔄 Executing swap...");
    const txHash = await market.swap(
      {
        xToY,
        pair,
        amount: swapAmount,
        slippage,
        byAmountIn: true,
        accountX,
        accountY,
        owner: keypair.publicKey,
        estimatedPriceAfterSwap: new BN(1), // Add required field
      },
      keypair as any
    );

    console.log("✅ Swap completed successfully!");
    console.log(`Transaction hash: ${txHash}`);
  } catch (error) {
    console.error("❌ Swap failed:", error);
    // Log more details about the error
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
}

// New swap function following documentation pattern
async function performDocumentationStyleSwap(market: Market): Promise<void> {
  console.log("\n=== DOCUMENTATION-STYLE SWAP ===");

  // Get 40% of available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
  const swapAmount = wrappedSolBalance.muln(40).divn(100); // 40% of balance

  if (swapAmount.eqn(0)) {
    console.log("❌ No wrapped SOL available for swap");
    return;
  }

  console.log(
    `Available wrapped SOL: ${wrappedSolBalance.toString()} lamports`
  );
  console.log(`Swap amount (40%): ${swapAmount.toString()} lamports`);

  try {
    // 1. Create the wrapped ETH pair (as per documentation)
    const feeTier = {
      fee: new BN(1000), // 0.1% fee
      tickSpacing: 1,
    };

    // Try different popular token pairs that might exist
    const tokenPairs = [
      { tokenA: ETH_MINT, tokenB: USDT_MINT, name: "ETH/USDT" },
      { tokenA: ETH_MINT, tokenB: USDC_MINT, name: "ETH/USDC" },
    ];

    for (const { tokenA, tokenB, name } of tokenPairs) {
      console.log(`\n--- Trying ${name} ---`);

      const wrappedEthPair = new Pair(tokenA, tokenB, feeTier);
      console.log(
        `Pair created: ${wrappedEthPair.tokenX.toString()} ↔ ${wrappedEthPair.tokenY.toString()}`
      );

      // 2. Check if pool exists
      const poolExists = await checkPoolExists(market, wrappedEthPair);
      if (!poolExists) {
        console.log(`Pool doesn't exist for ${name}, trying next...`);
        continue;
      }

      // 3. Swap params (following documentation)
      const xToY = false; // Start with false as in documentation
      const byAmountIn = true;
      const slippage = toDecimal(0, 0); // 0% slippage as in docs

      // 4. Lower max cross count
      let maxCrosses = TICK_CROSSES_PER_IX_NATIVE_TOKEN;
      const referralAccount: PublicKey | undefined = undefined;

      if (referralAccount) {
        maxCrosses -= 1;
      }

      console.log(
        `Swap params: xToY=${xToY}, byAmountIn=${byAmountIn}, amount=${swapAmount.toString()}`
      );
      console.log(`Max crosses: ${maxCrosses}, Slippage: 0%`);

      // 5. Get pool address
      let poolAddress: PublicKey;
      try {
        poolAddress = wrappedEthPair.getAddress(market.program.programId);
        console.log(`Pool address: ${poolAddress.toString()}`);
      } catch (error) {
        console.log(`❌ Failed to get pool address for ${name}:`, error);
        continue;
      }

      // 6. Simulate the swap first (if simulation function is available)
      try {
        console.log("🔄 Simulating swap...");

        // Since swapSimulation might not be available, we'll try direct swap
        const isWrappedEthInput =
          (xToY && wrappedEthPair.tokenX.equals(NATIVE_MINT)) ||
          (!xToY && wrappedEthPair.tokenY.equals(NATIVE_MINT));

        console.log(`Is wrapped ETH input: ${isWrappedEthInput}`);

        // 7. Get token accounts
        const accountX = getAssociatedTokenAddressSync(
          wrappedEthPair.tokenX,
          keypair.publicKey,
          true,
          wrappedEthPair.tokenX.equals(USDT_MINT) ||
            wrappedEthPair.tokenX.equals(USDC_MINT)
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID
        );

        const accountY = getAssociatedTokenAddressSync(
          wrappedEthPair.tokenY,
          keypair.publicKey,
          true,
          wrappedEthPair.tokenY.equals(USDT_MINT) ||
            wrappedEthPair.tokenY.equals(USDC_MINT)
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID
        );

        console.log(`Account X: ${accountX.toString()}`);
        console.log(`Account Y: ${accountY.toString()}`);

        // 8. Execute the swap
        console.log("🚀 Executing swap...");
        const txHash = await market.swap(
          {
            xToY,
            pair: wrappedEthPair,
            amount: swapAmount,
            slippage: new BN(100), // Small slippage in BN format
            byAmountIn,
            accountX,
            accountY,
            owner: keypair.publicKey,
            estimatedPriceAfterSwap: new BN(1),
          },
          keypair as any
        );

        console.log("✅ Swap completed successfully!");
        console.log(`Transaction hash: ${txHash}`);
        return; // Exit after successful swap
      } catch (error) {
        console.error(`❌ Swap failed for ${name}:`, error);
        if (error instanceof Error) {
          console.error("Error message:", error.message);
        }
        continue; // Try next pair
      }
    }

    console.log("❌ All swap attempts failed");
  } catch (error) {
    console.error("❌ Critical error in documentation-style swap:", error);
  }
}

// Diagnostic function to understand the Invariant market
async function diagnoseInvariantMarket(market: Market): Promise<void> {
  console.log("\n=== INVARIANT MARKET DIAGNOSIS ===");

  try {
    // 1. Check all available pools
    console.log("1. Fetching all pools...");
    const pools = await market.getAllPools();
    console.log(`✅ Found ${pools.length} total pools`);

    if (pools.length === 0) {
      console.log(
        "❌ NO POOLS FOUND - This might be the wrong network or program ID"
      );
      return;
    }

    // 2. Show first 10 pools for reference
    console.log("\n2. Available pools (first 10):");
    pools.slice(0, 10).forEach((pool, index) => {
      console.log(
        `   ${index + 1}. ${pool.tokenX.toString()} ↔ ${pool.tokenY.toString()}`
      );
      console.log(`      Fee: ${pool.fee?.toString() || "unknown"}`);
    });

    // 3. Check for our specific tokens
    console.log("\n3. Checking for our tokens in any pool...");
    const ethPools = pools.filter(
      (pool) => pool.tokenX.equals(ETH_MINT) || pool.tokenY.equals(ETH_MINT)
    );
    console.log(`   ETH pools found: ${ethPools.length}`);

    const usdtPools = pools.filter(
      (pool) => pool.tokenX.equals(USDT_MINT) || pool.tokenY.equals(USDT_MINT)
    );
    console.log(`   USDT pools found: ${usdtPools.length}`);

    const usdcPools = pools.filter(
      (pool) => pool.tokenX.equals(USDC_MINT) || pool.tokenY.equals(USDC_MINT)
    );
    console.log(`   USDC pools found: ${usdcPools.length}`);

    // 4. Show ETH pools in detail
    if (ethPools.length > 0) {
      console.log("\n4. ETH pools details:");
      ethPools.forEach((pool, index) => {
        const isEthX = pool.tokenX.equals(ETH_MINT);
        const otherToken = isEthX ? pool.tokenY : pool.tokenX;
        console.log(`   ${index + 1}. ETH ↔ ${otherToken.toString()}`);
        console.log(`      Fee: ${pool.fee?.toString() || "unknown"}`);
      });
    }
  } catch (error) {
    console.error("❌ Failed to diagnose market:", error);
  }
}

// Get all pools for specific token pairs with their actual addresses and fee values
async function getPoolsForTokenPair(
  market: Market,
  tokenA: PublicKey,
  tokenB: PublicKey
): Promise<Array<{ pool: any; address: PublicKey }>> {
  const allPools = await market.getAllPools();
  const matchingPools = allPools.filter(
    (pool) =>
      (pool.tokenX.equals(tokenA) && pool.tokenY.equals(tokenB)) ||
      (pool.tokenX.equals(tokenB) && pool.tokenY.equals(tokenA))
  );

  // Get pool addresses for each matching pool
  const poolsWithAddresses = [];
  for (const pool of matchingPools) {
    try {
      // Create a temporary pair to get the address using the actual pool's fee structure
      const tempFeeTier = {
        fee: pool.fee,
        tickSpacing: pool.tickSpacing || 1,
      };
      const tempPair = new Pair(pool.tokenX, pool.tokenY, tempFeeTier);
      const poolAddress = tempPair.getAddress(market.program.programId);

      poolsWithAddresses.push({
        pool,
        address: poolAddress,
      });
    } catch (error) {
      console.log(`Failed to get address for pool:`, error);
    }
  }

  return poolsWithAddresses;
}

// Enhanced smart swap function that uses actual on-chain pool addresses and fee values
async function smartSwapEthToUsdt(market: Market): Promise<void> {
  console.log("\n=== ENHANCED SMART SWAP: ETH TO USDT/USDC ===");

  // Get 40% of available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
  const swapAmount = wrappedSolBalance.muln(40).divn(100); // 40% of balance

  if (swapAmount.eqn(0)) {
    console.log("❌ No wrapped SOL available for swap");
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
        console.log(`  ❌ No pools found for ${name}`);
        continue;
      }

      console.log(`  ✅ Found ${poolsWithAddresses.length} pools for ${name}`);

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
          console.log("  🔄 Simulating swap...");
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
            console.log(`  ❌ Simulation failed: ${simulation.status}`);
            continue;
          }

          console.log("  ✅ Simulation successful!");
          console.log(
            `  Estimated price after swap: ${simulation.priceAfterSwap}`
          );

          // Execute the swap
          console.log("  🚀 Executing swap...");
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

          console.log("  ✅ Swap completed successfully!");
          console.log(`  Transaction hash: ${txHash}`);
          return; // Exit after successful swap
        } catch (error) {
          console.log(`  ❌ Error with pool ${i + 1}:`, error);
          if (error instanceof Error) {
            console.log(`  Error message: ${error.message}`);
          }
          continue;
        }
      }
    } catch (error) {
      console.log(`❌ Error processing ${name}:`, error);
      continue;
    }
  }

  console.log("❌ All swap attempts failed - no suitable pools found");
}

// Function to find actual pools and their fee tier addresses
async function findActualPoolsForTokens(
  market: Market,
  tokenA: PublicKey,
  tokenB: PublicKey
): Promise<Array<{ pool: any; feeValue: BN }>> {
  try {
    const pools = await market.getAllPools();

    // Find pools that match our token pair (in either direction)
    const matchingPools = pools.filter(
      (pool) =>
        (pool.tokenX.equals(tokenA) && pool.tokenY.equals(tokenB)) ||
        (pool.tokenX.equals(tokenB) && pool.tokenY.equals(tokenA))
    );

    console.log(
      `Found ${matchingPools.length} pools for ${tokenA
        .toBase58()
        .slice(0, 8)}.../${tokenB.toBase58().slice(0, 8)}...`
    );

    // Return pools with their fee values
    return matchingPools.map((pool) => ({
      pool,
      feeValue: pool.fee,
    }));
  } catch (error) {
    console.error("Error finding actual pools:", error);
    return [];
  }
}

// Function to perform swap using actual pool address (no Pair constructor)
async function swapUsingActualPool(
  market: Market,
  poolAddress: PublicKey,
  tokenA: PublicKey,
  tokenB: PublicKey,
  swapAmount: BN,
  swapFromA: boolean = true
): Promise<boolean> {
  try {
    console.log(
      `\n🔄 Attempting swap using actual pool: ${poolAddress.toBase58()}`
    );

    // Get the actual pool data
    const poolData = await market.getPoolByAddress(poolAddress);
    console.log(
      `Pool tokens: ${poolData.tokenX.toString()} ↔ ${poolData.tokenY.toString()}`
    );
    console.log(`Pool fee: ${poolData.fee.toString()}`);

    // Determine swap direction based on token positions in the pool
    let xToY: boolean;
    if (poolData.tokenX.equals(tokenA)) {
      xToY = swapFromA; // swapping from A to B, and A is tokenX
    } else {
      xToY = !swapFromA; // swapping from A to B, but A is tokenY
    }

    console.log(`Swap direction (xToY): ${xToY}`);

    // Get associated token accounts
    const accountX = getAssociatedTokenAddressSync(
      poolData.tokenX,
      keypair.publicKey,
      true,
      poolData.tokenX.equals(USDT_MINT) || poolData.tokenX.equals(USDC_MINT)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID
    );

    const accountY = getAssociatedTokenAddressSync(
      poolData.tokenY,
      keypair.publicKey,
      true,
      poolData.tokenY.equals(USDT_MINT) || poolData.tokenY.equals(USDC_MINT)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID
    );

    console.log(
      `Account X (${poolData.tokenX
        .toString()
        .slice(0, 8)}...): ${accountX.toString()}`
    );
    console.log(
      `Account Y (${poolData.tokenY
        .toString()
        .slice(0, 8)}...): ${accountY.toString()}`
    );

    // Create a minimal pair object for the swap
    // We'll use the pool's actual fee tier
    const feeTier = {
      fee: poolData.fee,
      tickSpacing: poolData.tickSpacing || 1,
    };

    const pair = new Pair(poolData.tokenX, poolData.tokenY, feeTier);

    // Perform simulation first
    console.log("🔍 Simulating swap...");
    const slippage = toDecimal(0, 0); // 0% slippage

    const simulation = await swapSimulation(
      xToY,
      true, // byAmountIn
      swapAmount,
      undefined,
      slippage,
      market,
      poolAddress, // Use the actual pool address directly
      TICK_CROSSES_PER_IX_NATIVE_TOKEN
    );

    if (simulation.status !== SimulationStatus.Ok) {
      console.log(`❌ Simulation failed: ${simulation.status}`);
      return false;
    }

    console.log("✅ Simulation successful!");
    console.log(`Estimated price after swap: ${simulation.priceAfterSwap}`);

    // Execute the swap
    console.log("🚀 Executing swap...");
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

    console.log("✅ Swap completed successfully!");
    console.log(`Transaction hash: ${txHash}`);
    return true;
  } catch (error) {
    console.error("❌ Swap failed:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
    }
    return false;
  }
}

// Enhanced smart swap that uses actual pool addresses
async function enhancedSmartSwap(market: Market): Promise<void> {
  console.log("\n=== ENHANCED SMART SWAP: Using Actual Pool Addresses ===");

  // Get 40% of available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
  const swapAmount = wrappedSolBalance.muln(40).divn(100); // 40% of balance

  if (swapAmount.eqn(0)) {
    console.log("❌ No wrapped SOL available for swap");
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
    console.log(`\n--- Trying ${name} with actual pools ---`);

    // Find actual pools for this token pair
    const actualPools = await findActualPoolsForTokens(market, tokenA, tokenB);

    if (actualPools.length === 0) {
      console.log(`❌ No pools found for ${name}`);
      continue;
    }

    // Sort pools by fee (try lower fees first, usually more liquid)
    actualPools.sort((a, b) => a.feeValue.cmp(b.feeValue));

    console.log(
      `Found ${actualPools.length} pools, trying in order of fee size:`
    );
    actualPools.forEach((poolInfo, index) => {
      const feePercent = poolInfo.feeValue.toNumber() / 1000000000; // Convert to percentage
      console.log(
        `  ${
          index + 1
        }. Fee: ${poolInfo.feeValue.toString()} (${feePercent.toFixed(4)}%)`
      );
    });

    // Try each pool until one works
    for (let i = 0; i < actualPools.length; i++) {
      const poolInfo = actualPools[i];
      const feePercent = poolInfo.feeValue.toNumber() / 1000000000;

      console.log(
        `\n  Trying pool ${i + 1}/${
          actualPools.length
        } (Fee: ${feePercent.toFixed(4)}%)`
      );

      // Get the pool address from the pool object
      const poolAddress =
        poolInfo.pool.address || new PublicKey(poolInfo.pool.pubkey);

      const success = await swapUsingActualPool(
        market,
        poolAddress,
        tokenA,
        tokenB,
        swapAmount,
        true // swap from tokenA (ETH) to tokenB (USDT/USDC)
      );

      if (success) {
        console.log(`✅ Successfully completed swap using ${name} pool!`);
        return; // Exit after successful swap
      } else {
        console.log(`❌ Failed with this pool, trying next...`);
      }
    }

    console.log(`❌ All ${name} pools failed`);
  }

  console.log("❌ All token pairs and pools failed");
}

async function main() {
  console.log("🚀 Starting Invariant swap...");

  try {
    // Check the wallet balance
    await checkBalance();

    // Create associated token accounts for ETH, USDT, and USDC
    await createAssociatedTokenAccount(ETH_MINT);
    await createAssociatedTokenAccount(USDT_MINT);
    await createAssociatedTokenAccount(USDC_MINT);

    // Check token balances before wrapping
    console.log("Checking token balance for ETH ......");
    await checkTokenBalance(ETH_MINT);
    console.log("Checking token balance for USDT ......");
    await checkTokenBalance(USDT_MINT);
    console.log("Checking token balance for USDC ......");
    await checkTokenBalance(USDC_MINT);

    // Wrap some SOL into WSOL (be conservative with the amount)
    try {
      console.log("\n--- Wrapping SOL ---");
      // wrap 10% of the wallet balance into WSOL
      const walletBalance = await connection.getBalance(keypair.publicKey);
      const wrapAmount = (walletBalance * 0.1) / LAMPORTS_PER_SOL; // Convert to SOL units
      await wrapSol(wrapAmount);

      // Check token balances after wrapping
      console.log("\n--- Token balances after wrapping ---");
      await checkTokenBalance(ETH_MINT);
    } catch (error) {
      console.error("Failed to wrap SOL:", error);
    }

    // Initialize the Invariant market
    console.log("\n--- Initializing Invariant Market ---");
    const market = await initializeInvariantMarket();

    // Run quick diagnostics to show available pools
    console.log("\n=== QUICK DIAGNOSTICS ===");
    const allPools = await market.getAllPools();
    console.log(`Total pools available: ${allPools.length}`);

    // Count ETH pools specifically
    const ethPools = allPools.filter(
      (pool) => pool.tokenX.equals(ETH_MINT) || pool.tokenY.equals(ETH_MINT)
    );
    console.log(`ETH pools available: ${ethPools.length}`);

    // Count USDT pools
    const usdtPools = allPools.filter(
      (pool) => pool.tokenX.equals(USDT_MINT) || pool.tokenY.equals(USDT_MINT)
    );
    console.log(`USDT pools available: ${usdtPools.length}`);

    // Count USDC pools
    const usdcPools = allPools.filter(
      (pool) => pool.tokenX.equals(USDC_MINT) || pool.tokenY.equals(USDC_MINT)
    );
    console.log(`USDC pools available: ${usdcPools.length}`);

    // Try the enhanced smart swap
    await smartSwapEthToUsdt(market);

    // Check final balances after swap
    console.log("\n--- Final Token Balances ---");
    await checkTokenBalance(ETH_MINT);
    await checkTokenBalance(USDT_MINT);
    await checkTokenBalance(USDC_MINT);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main()
  .then(() => console.log("Script completed successfully"))
  .catch((error) => console.error("Error in script:", error));
