import Razorpay from "razorpay";
import { env } from "./env.js";
import { AppError } from "../utils/AppError.js";

let instance: Razorpay | null = null;

export const getRazorpay = (): Razorpay => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, "Online payments are not configured on the server", "RAZORPAY_NOT_CONFIGURED");
  }
  instance ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return instance;
};
