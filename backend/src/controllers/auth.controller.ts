import type { Request, Response } from "express";
import {
  googleAuthUser,
  resetUserPassword,
  sendOtpUser,
  signInUser,
  signUpUser,
  verifyUserOtp,
} from "../services/auth.service.js";
import { clearSessionCookie, setSessionCookie } from "../utils/cookies.js";
import { signSessionToken } from "../utils/token.js";
import type { UserDocument } from "../models/user.model.js";

/** Starts the session and returns the sanitised user (the model's toJSON strips secrets). */
const startSession = (res: Response, user: UserDocument, status = 200) => {
  setSessionCookie(res, signSessionToken(user._id.toString()));
  return res.status(status).json(user);
};

export const signUp = async (req: Request, res: Response) =>
  startSession(res, await signUpUser(req.body), 201);

export const signIn = async (req: Request, res: Response) =>
  startSession(res, await signInUser(req.body));

export const signOut = (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(200).json({ message: "Logout successfully" });
};

export const sendOtp = async (req: Request, res: Response) => {
  await sendOtpUser(req.body);
  res.status(200).json({ message: "If an account exists for this email, an OTP has been sent" });
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { resetToken } = await verifyUserOtp(req.body);
  res.status(200).json({ message: "OTP verified successfully", resetToken });
};

export const resetPassword = async (req: Request, res: Response) => {
  await resetUserPassword(req.body);
  res.status(200).json({ message: "Password reset successfully" });
};

/** Sign-in and sign-up with Google are the same find-or-create operation. */
export const googleAuth = async (req: Request, res: Response) => {
  const { user, created } = await googleAuthUser(req.body);
  return startSession(res, user, created ? 201 : 200);
};
