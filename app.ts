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
export async function createAssociatedTokenAccount(mint: PublicKey) {
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
export async function checkTokenBalance(mint: PublicKey) {
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
export async function checkBalance() {
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} ETH`);
}

// Function to wrap SOL into wrapped SOL (WSOL) tokens
export async function wrapSol(amountInSol: number): Promise<PublicKey> {
  const lamportsToWrap = Math.floor(amountInSol * LAMPORTS_PER_SOL);

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
export async function initializeInvariantMarket(): Promise<Market> {
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
export async function getAvailableWrappedSolBalance(): Promise<BN> {
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

// Get all pools for specific token pairs with their actual addresses and fee values
export async function getPoolsForTokenPair(
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

// main swap
export async function smartSwapEthToUsdt(market: Market): Promise<void> {
  console.log("\n=== SWAP: ETH TO USDT/USDC ===");

  // Get 40% of available wrapped SOL balance
  const wrappedSolBalance = await getAvailableWrappedSolBalance();
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

async function main() {
  console.log("Starting Invariant swap...");

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
    console.error("Error:", error);
  }
}

main()
  .then(() => console.log("Script completed successfully"))
  .catch((error) => console.error("Error in script:", error));
