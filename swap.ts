import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";

import {
  Market,
  Network,
  Pair
} from "@invariant-labs/sdk-eclipse";

import BN from "bn.js";
import { getStoredKeypair } from "./get-keypair";

// Eclipse testnet RPC endpoint
const ECLIPSE_RPC_URL = "https://testnet.dev2.eclipsenetwork.xyz";

// Token addresses on Eclipse 
const SOL_MINT = new PublicKey("BeRUj3h7BqkbdfFU7FBNYbodgf8GCHodzKvF9aVjNNfL"); // Wrapped SOL
const USDT_MINT = new PublicKey("CEBP3CqAbW4zdZA57H2wfaSG1QNdzQ72GiQEbQXyW9Tm"); // USDT

// Constants for swap parameters
const DEFAULT_SLIPPAGE = 0.01; // 1%
const DEFAULT_FEE = 0.006; // 0.6%
const DEFAULT_TICK_SPACING = 10;

class InvariantEclipseTrader {
  private connection: Connection;
  private wallet: Keypair;
  private market!: Market;

  constructor() {
    this.connection = new Connection(ECLIPSE_RPC_URL, "confirmed");
    this.wallet = getStoredKeypair();
  }

  // 1. Get wallet address
  getWallet(): string {
    console.log(
      "Generated new wallet address:",
      this.wallet.publicKey.toString()
    );
    console.log(
      "Private key (keep secure):",
      Buffer.from(this.wallet.secretKey).toString("hex")
    );
    return this.wallet.publicKey.toString();
  }

  // 2. Request airdrop
  async requestAirdrop(): Promise<void> {
    try {
      console.log("Requesting airdrop...");
      const airdropSignature = await this.connection.requestAirdrop(
        this.wallet.publicKey,
        2 * LAMPORTS_PER_SOL // Request 2 SOL
      );

      await this.connection.confirmTransaction(airdropSignature, "confirmed");
      console.log("Airdrop successful! Transaction:", airdropSignature);
    } catch (error) {
      console.error(" Airdrop failed:", error);
      throw error;
    }
  }

  // 3. Show balance
  async showBalance(): Promise<void> {
    try {
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      console.log(
        `Current balance for ${this.wallet.publicKey.toString()}: ${balance} lamports`
      );

      // Convert balance to SOL
      const solBalance = balance / LAMPORTS_PER_SOL;

      console.log("Wallet Balance:");
      console.log(`SOL: ${solBalance.toFixed(6)} SOL`);

      // Try to get USDT balance if account exists
      try {
        const usdtTokenAccount = await getAssociatedTokenAddress(
          USDT_MINT,
          this.wallet.publicKey
        );

        const usdtAccount = await getAccount(this.connection, usdtTokenAccount);
        const usdtBalance = Number(usdtAccount.amount) / Math.pow(10, 6); // Assuming USDT has 6 decimals
        console.log(`USDT: ${usdtBalance.toFixed(6)} USDT`);
      } catch (error) {
        console.log("USDT: 0.000000 USDT (no account)");
      }
    } catch (error) {
      console.error("Failed to fetch balance:", error);
      throw error;
    }
  }

  // Initialize market connection
  async initializeMarket(): Promise<void> {
    try {
      console.log("Initializing Invariant market connection...");
      this.market = await Market.build(
        Network.TEST, // Use testnet
        {
          signTransaction: async (tx) => {
            if ("partialSign" in tx) {
              tx.partialSign(this.wallet);
            }
            return tx;
          },
          signAllTransactions: async (txs) => {
            txs.forEach((tx) => {
              if ("partialSign" in tx) {
                tx.partialSign(this.wallet);
              }
            });
            return txs;
          },
          publicKey: this.wallet.publicKey,
        },
        this.connection
      );
      console.log("Market initialized successfully");
    } catch (error) {
      console.error("Failed to initialize market:", error);
      throw error;
    }
  }

  // Create token accounts if they don't exist
  async ensureTokenAccounts(): Promise<{
    accountX: PublicKey;
    accountY: PublicKey;
  }> {
    try {
      const solTokenAccount = await getAssociatedTokenAddress(
        SOL_MINT,
        this.wallet.publicKey
      );

      const usdtTokenAccount = await getAssociatedTokenAddress(
        USDT_MINT,
        this.wallet.publicKey
      );

      const transaction = new Transaction();
      let needsTransaction = false;

      // Check if SOL token account exists
      try {
        await getAccount(this.connection, solTokenAccount);
      } catch (error) {
        console.log("Creating SOL token account...");
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.wallet.publicKey,
            solTokenAccount,
            this.wallet.publicKey,
            SOL_MINT
          )
        );
        needsTransaction = true;
      }

      // Check if USDT token account exists
      try {
        await getAccount(this.connection, usdtTokenAccount);
      } catch (error) {
        console.log("Creating USDT token account...");
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.wallet.publicKey,
            usdtTokenAccount,
            this.wallet.publicKey,
            USDT_MINT
          )
        );
        needsTransaction = true;
      }

      if (needsTransaction) {
        const signature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.wallet]
        );
        console.log("Token accounts created:", signature);
      }

      return {
        accountX: solTokenAccount,
        accountY: usdtTokenAccount,
      };
    } catch (error) {
      console.error("Failed to ensure token accounts:", error);
      throw error;
    }
  }

  // 4. Swap SOL to USDT
  async swapSolToUsdt(): Promise<void> {
    try {
      console.log("🔄 Starting SOL to USDT swap...");

      await this.initializeMarket();
      const { accountX, accountY } = await this.ensureTokenAccounts();

      // Create pair for SOL/USDT
      const pair = new Pair(SOL_MINT, USDT_MINT, {
        fee: new BN(DEFAULT_FEE * 1000), // Convert to basis points (0.6% = 6)
        tickSpacing: DEFAULT_TICK_SPACING,
      });

      // Swap parameters
      const xToY = true; // SOL (X) to USDT (Y)
      const byAmountIn = true;
      const swapAmount = new BN(LAMPORTS_PER_SOL / 2); // Swap 0.5 SOL

      console.log(`Swapping 0.5 SOL for USDT...`);

      // Execute the swap with a fixed price estimate
      const txHash = await this.market.swap(
        {
          xToY,
          pair,
          amount: swapAmount,
          slippage: new BN(DEFAULT_SLIPPAGE * 100), // Convert to percentage (1% = 1)
          byAmountIn,
          accountX,
          accountY,
          owner: this.wallet.publicKey,
          estimatedPriceAfterSwap: new BN(1), // Use 1:1 as a base price estimate
        },
        this.wallet
      );

      console.log("Swap completed successfully!");
      console.log("Transaction hash:", txHash);
    } catch (error) {
      console.error("Swap failed:", error);
      throw error;
    }
  }

  // Main execution function
  async run(): Promise<void> {
    try {
      console.log("Starting Invariant Eclipse Trading Demo...\n");

      // 1. Generate wallet
      this.getWallet();
      console.log("");

      // 2. Request airdrop
      await this.requestAirdrop();
      console.log("");

      // 3. Show initial balance
      console.log("Initial Balance:");
      await this.showBalance();
      console.log("");

      // Wait a moment for airdrop to settle
      // console.log("Waiting for network confirmation...");
      // await new Promise((resolve) => setTimeout(resolve, 5000));

      // // 4. Perform swap
      // await this.swapSolToUsdt();
      // console.log("");

      // // 5. Show final balance
      // console.log("Final Balance:");
      // await this.showBalance();

      console.log("\n Trading demo completed successfully!");
    } catch (error) {
      console.error("\n Demo failed:", error);
      process.exit(1);
    }
  }
}

// Execute the demo
async function main() {
  const trader = new InvariantEclipseTrader();
  await trader.run();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { InvariantEclipseTrader };
