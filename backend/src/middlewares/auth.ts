import type { NextFunction, Request, Response } from "express";
import User, { type UserRole } from "../models/user.model.js";
import { AppError } from "../utils/AppError.js";
import { verifyToken } from "../utils/token.js";

/**
 * Authentication: proves who the caller is. The role is always re-read from
 * the database so a stale or forged token can never grant privileges.
 */
export const isAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const token: unknown = req.cookies?.token;
  if (typeof token !== "string" || !token) {
    throw AppError.unauthorized("Authentication token missing");
  }

  let userId: string;
  try {
    const payload = verifyToken(token);
    // Special-purpose tokens (e.g. password reset) are not sessions.
    if (payload.purpose) throw new Error("Not a session token");
    userId = payload.userId;
  } catch {
    throw AppError.unauthorized("Invalid or expired token");
  }

  const user = await User.findById(userId).select("role").lean();
  if (!user) throw AppError.unauthorized("Account no longer exists");

  req.userId = userId;
  req.userRole = user.role;
  next();
};

/** Authorization: restricts a route to the given roles. Use after `isAuth`. */
export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      throw AppError.forbidden();
    }
    next();
  };

/** Returns the authenticated user id; only valid behind `isAuth`. */
export const currentUserId = (req: Request): string => {
  if (!req.userId) throw AppError.unauthorized();
  return req.userId;
};
