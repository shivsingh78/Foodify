import { z } from "zod";
import { emailSchema, mobileSchema, passwordSchema } from "./common.schema.js";

const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Full name must be at least 2 characters")
  .max(80, "Full name must be at most 80 characters");

/**
 * Public signup. `role` is intentionally NOT accepted: privileged roles
 * (owner / deliveryBoy) can never be chosen by an anonymous client.
 */
export const signUpSchema = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  mobile: mobileSchema,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const sendOtpSchema = z.strictObject({ email: emailSchema });
export type SendOtpInput = z.infer<typeof sendOtpSchema>;

export const OTP_LENGTH = 6;

export const verifyOtpSchema = z.strictObject({
  email: emailSchema,
  otp: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const resetPasswordSchema = z.strictObject({
  email: emailSchema,
  newPassword: passwordSchema,
  resetToken: z.string().min(1, "Reset token is required"),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Google authentication (sign-in and sign-up are the same operation: find or create).
 * Identity (email, name, picture, verified status) is derived from the verified Firebase
 * ID token on the server, never from the request body. `mobile` is optional.
 */
export const googleAuthSchema = z.strictObject({
  idToken: z.string().min(1, "Firebase ID token is required"),
  mobile: mobileSchema.optional(),
});
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

export const googleSignUpSchema = googleAuthSchema;
export const googleSignInSchema = googleAuthSchema;
export type GoogleSignUpInput = GoogleAuthInput;
export type GoogleSignInInput = GoogleAuthInput;
