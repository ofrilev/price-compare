import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { readJson, writeJson } from "./store.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const JWT_EXPIRY = "7d";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): { userId: string; username: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Get all users from storage
 */
export async function getUsers(): Promise<User[]> {
  try {
    return await readJson<User[]>("users.json");
  } catch {
    return [];
  }
}

/**
 * Save users to storage
 */
export async function saveUsers(users: User[]): Promise<void> {
  await writeJson("users.json", users);
}

/**
 * Find a user by username
 */
export async function findUserByUsername(username: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.username === username) || null;
}

/**
 * Find a user by ID
 */
export async function findUserById(id: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.id === id) || null;
}

/**
 * Create a new user
 */
export async function createUser(username: string, password: string): Promise<User> {
  const users = await getUsers();
  
  // Check if user already exists
  if (users.find((u) => u.username === username)) {
    throw new Error("User already exists");
  }
  
  const passwordHash = await hashPassword(password);
  const user: User = {
    id: uuidv4(),
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  
  users.push(user);
  await saveUsers(users);
  
  return user;
}

/**
 * Authenticate a user with username and password
 */
export async function login(username: string, password: string): Promise<{ user: User; token: string } | null> {
  const user = await findUserByUsername(username);
  if (!user) {
    return null;
  }
  
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return null;
  }
  
  const token = generateToken(user.id, user.username);
  return { user, token };
}
