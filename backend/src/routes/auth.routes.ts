import express from "express";
import {
  googleAuthSchema,
  resetPasswordSchema,
  sendOtpSchema,
  signInSchema,
  signUpSchema,
  verifyOtpSchema,
} from "@foodify/validation";
import {
  googleAuth,
  resetPassword,
  sendOtp,
  signIn,
  signOut,
  signUp,
  verifyOtp,
} from "../controllers/auth.controller.js";
import { limits } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";

const authRouter = express.Router();

authRouter.post("/signup", limits.auth, validate(signUpSchema), signUp);
authRouter.post("/signin", limits.auth, validate(signInSchema), signIn);
authRouter.get("/signout", signOut);
authRouter.post("/send-otp", limits.otpSend, validate(sendOtpSchema), sendOtp);
authRouter.post("/verify-otp", limits.otpVerify, validate(verifyOtpSchema), verifyOtp);
authRouter.post("/reset-password", limits.auth, validate(resetPasswordSchema), resetPassword);
// Both endpoints are kept for existing clients; they behave identically.
authRouter.post("/google-signup", limits.auth, validate(googleAuthSchema), googleAuth);
authRouter.post("/google-signin", limits.auth, validate(googleAuthSchema), googleAuth);

export default authRouter;
