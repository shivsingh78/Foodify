import type { CookieOptions, Response } from "express";
import { isProduction } from "../config/env.js";

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const baseOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  // Cross-site (frontend and API on different domains) requires SameSite=None + Secure.
  sameSite: isProduction ? "none" : "lax",
});

export const setSessionCookie = (res: Response, token: string): void => {
  res.cookie("token", token, { ...baseOptions(), maxAge: SESSION_MAX_AGE_MS });
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie("token", baseOptions());
};
