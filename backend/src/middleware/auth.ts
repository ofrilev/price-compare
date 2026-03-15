import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/auth.js";

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

/**
 * Middleware to protect routes with JWT authentication
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  const token = authHeader.substring(7); // Remove "Bearer " prefix
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  
  req.userId = decoded.userId;
  req.username = decoded.username;
  next();
}
