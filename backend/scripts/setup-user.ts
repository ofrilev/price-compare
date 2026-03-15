import "dotenv/config";
import { createUser } from "../src/services/auth.js";
import readline from "readline";

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

  const username = await question("Username: ");
  if (!username.trim()) {
    console.error("Username cannot be empty");
    process.exit(1);
  }

  const password = await question("Password: ");
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

  try {
    const user = await createUser(username.trim(), password);
    console.log("\n✓ User created successfully!");
    console.log(`  ID: ${user.id}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Created: ${user.createdAt}`);
  } catch (error: any) {
    if (error.message === "User already exists") {
      console.error("\n✗ Error: User already exists");
    } else {
      console.error("\n✗ Error creating user:", error.message);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
