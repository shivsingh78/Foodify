import mongoose from "mongoose";
import { env } from "./env.js";

/** Connects to MongoDB. Throws on failure so the caller can abort start-up. */
export const connectDb = async (): Promise<void> => {
  await mongoose.connect(env.MONGODB_URL);
  console.log("✅ MongoDB connected");
};

export const disconnectDb = async (): Promise<void> => {
  await mongoose.disconnect();
};
