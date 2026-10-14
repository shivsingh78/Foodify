import { randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";

export type TokenPurpose = "password_reset";

export interface TokenPayload extends JwtPayload {
  userId: string;
  purpose?: TokenPurpose;
}

/** Session tokens carry no `purpose`; special-purpose tokens must be short-lived. */
export const signSessionToken = (userId: string): string =>
  jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: "7d" });

export const signPurposeToken = (
  userId: string,
  purpose: TokenPurpose,
  expiresIn: jwt.SignOptions["expiresIn"],
): { token: string; tokenId: string } => {
  const tokenId = randomUUID();
  const token = jwt.sign({ userId, purpose }, env.JWT_SECRET, { expiresIn, jwtid: tokenId });
  return { token, tokenId };
};

export const verifyToken = (token: string): TokenPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || typeof decoded.userId !== "string") {
    throw new Error("Malformed token");
  }
  return decoded as TokenPayload;
};
