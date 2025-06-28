import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

// Generate a new keypair
const keypair = Keypair.generate();

// Convert the secret key to a Buffer
const secretKeyBuffer = Buffer.from(keypair.secretKey);

// Create the keys directory if it doesn't exist
const keysDir = path.join(__dirname, "keys");
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir);
}

// Save the secret key to a file
const keyPath = path.join(keysDir, "keypair.json");
fs.writeFileSync(
  keyPath,
  JSON.stringify({
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(secretKeyBuffer),
  })
);

console.log("Keypair generated and saved!");
console.log("Public Key:", keypair.publicKey.toBase58());
console.log("Key file location:", keyPath);
console.log("\nWARNING: Keep your secret key safe and never share it!");
