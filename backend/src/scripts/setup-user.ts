import "dotenv/config";
import { createUser } from "../services/auth.js";
import readline from "readline";
import { join } from "path";

// Persist under /app when running this script (e.g. Docker WORKDIR); override with DATA_DIR in .env
if (!process.env.DATA_DIR?.trim()) {
  process.env.DATA_DIR = join("/app", "data");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log("=== User Setup ===");
  console.log("Create a new user account\n");

  // Support env vars for non-interactive use (e.g. Railway CLI, CI)
  let username = process.env.SETUP_USERNAME?.trim();
  let password = process.env.SETUP_PASSWORD?.trim();

  if (username && password) {
    console.log("Using SETUP_USERNAME and SETUP_PASSWORD from environment");
  } else {
    username = await question("Username: ");
    if (!username.trim()) {
      console.error("Username cannot be empty");
      process.exit(1);
    }

    password = await question("Password: ");
    if (!password.trim()) {
      console.error("Password cannot be empty");
      process.exit(1);
    }

    if (password.length < 6) {
      console.error("Password must be at least 6 characters");
      process.exit(1);
    }

    const confirmPassword = await question("Confirm Password: ");
    if (password !== confirmPassword) {
      console.error("Passwords do not match");
      process.exit(1);
    }
  }

  if (!username.trim()) {
    console.error("Username cannot be empty");
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error("Password must be at least 6 characters");
    process.exit(1);
  }

  try {
    const user = await createUser(username.trim(), password);
    console.log("\n✓ User created successfully!");
    console.log(`  ID: ${user.id}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Created: ${user.createdAt}`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === "User already exists") {
      console.error("\n✗ Error: User already exists");
    } else {
      console.error("\n✗ Error creating user:", msg);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
