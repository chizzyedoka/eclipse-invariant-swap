import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

/**
 * Reads the keypair from the stored file
 * @returns Keypair instance
 */
export function getStoredKeypair(): Keypair {
  try {
    // Read the keypair file
    const keyPath = path.join(__dirname, "keys", "keypair.json");
    const keyfileContent = fs.readFileSync(keyPath, "utf-8");
    const { secretKey } = JSON.parse(keyfileContent);

    // Create a Keypair instance from the secret key
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  } catch (error) {
    throw new Error(
      "Failed to read keypair. Have you run generate-keypair.ts first? Error: " +
        error
    );
  }
}
