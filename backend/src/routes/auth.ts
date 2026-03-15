import { Router } from "express";
import { login, createUser, findUserById } from "../services/auth.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

export const authRouter = Router();

/**
 * POST /api/auth/login
 * Login with username and password
 */
authRouter.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    
    const result = await login(username, password);
    if (!result) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    
    res.json({
      token: result.token,
      user: {
        id: result.user.id,
        username: result.user.username,
        createdAt: result.user.createdAt,
      },
    });
  } catch (err) {
    console.error("[Auth] Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/register
 * Register a new user (optional, can be disabled in production)
 */
authRouter.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    
    const user = await createUser(username, password);
    
    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      },
    });
  } catch (err: any) {
    if (err.message === "User already exists") {
      return res.status(409).json({ error: "User already exists" });
    }
    console.error("[Auth] Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (protected route)
 */
authRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await findUserById(req.userId!);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("[Auth] Get me error:", err);
    res.status(500).json({ error: "Failed to get user info" });
  }
});
