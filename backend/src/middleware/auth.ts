import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/auth.js";

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

/**
 * Middleware to protect routes with JWT authentication
 * Supports both Authorization header (for regular requests) and token query param (for EventSource/SSE)
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Check Authorization header first (for regular requests)
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }
  
  // Fallback to query parameter (for EventSource/SSE which can't send headers)
  if (!token && req.query.token && typeof req.query.token === "string") {
    token = req.query.token;
  }
  
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  
  req.userId = decoded.userId;
  req.username = decoded.username;
  next();
}
