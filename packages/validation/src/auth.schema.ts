import { z } from "zod";

/**
 * -------------------------
 * SIGN UP
 * -------------------------
 */
export const signUpSchema = z.strictObject({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters"),

  email: z
    .email("Please provide a valid email")
    .transform((email) => email.trim().toLowerCase()),

  password: z
    .string()
    .min(6, "Password must be at least 6 characters"),

  mobile: z
    .string()
    .trim()
    .min(10, "Mobile number must be at least 10 digits")
});

export type SignUpInput = z.infer<typeof signUpSchema>;


/**
 * -------------------------
 * SIGN IN
 * -------------------------
 */
export const signInSchema = z.strictObject({
  email: z
    .email("Please provide a valid email")
    .transform((email) => email.trim().toLowerCase()),

  password: z
    .string()
    .min(1, "Password is required")
});

export type SignInInput = z.infer<typeof signInSchema>;


/**
 * -------------------------
 * SEND OTP
 * -------------------------
 */
export const sendOtpSchema = z.strictObject({
  email: z
    .email("Please provide a valid email")
    .transform((email) => email.trim().toLowerCase())
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;


/**
 * -------------------------
 * VERIFY OTP
 * -------------------------
 */
export const verifyOtpSchema = z.strictObject({
  email: z
    .email("Please provide a valid email")
    .transform((email) => email.trim().toLowerCase()),

  otp: z
    .string()
    .regex(/^\d{4}$/, "OTP must be exactly 4 digits")
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;


/**
 * -------------------------
 * RESET PASSWORD
 * -------------------------
 */
export const resetPasswordSchema = z.strictObject({
  email: z
    .email("Please provide a valid email")
    .transform((email) => email.trim().toLowerCase()),

  newPassword: z
    .string()
    .min(6, "Password must be at least 6 characters"),
    resetToken: z.string().min(1,"Reset  token is required"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;


/**
 * -------------------------
 * GOOGLE SIGNUP 
 * -------------------------
 *
 * `role` is intentionally NOT accepted.
 * Public clients must not be able to choose
 * owner/deliveryBoy privileges.
 */

export const googleSignUpSchema = z.strictObject({
  fullName:z
  .string()
  .trim()
  .min(2,"Full name must be at least 2 characters"),

  email:z.email("Please provide a valid email"),

  mobile: z.string()
  .trim().min(10,"Mobile number must be at least 10 characters")
})

export type googleSignUpInput = z.infer<typeof googleSignUpSchema>

/**
 * -------------------------
 * GOOGLE  SIGNIN
 * -------------------------
 */

export const googleSignInSchema = z.strictObject({
  email:z.email("Please provide a valid email")
})

export type googleSignInInput = z.infer<typeof googleSignInSchema>
