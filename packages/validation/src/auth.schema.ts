import { z } from "zod";

export const signUpSchema = z.strictObject({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters"),

  email: z
    .email("Please provide a valid email"),

  password: z
    .string()
    .min(6, "Password must be at least 6 characters"),

  mobile: z
    .string()
    .trim()
    .min(10, "Mobile number must be at least 10 characters"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;