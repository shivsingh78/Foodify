import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createApp } from "../src/app.js";

export const app = createApp();

/** Connects to a fresh, uniquely named database for this test file. */
export const useTestDb = () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URL as string, {
      dbName: `foodify_test_${Math.random().toString(36).slice(2)}`,
    });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
};

export const ORIGIN = "http://localhost:5173";

export const signUp = async (overrides: Record<string, unknown> = {}) => {
  const body = {
    fullName: "Test User",
    email: `user${Math.random().toString(36).slice(2)}@example.com`,
    password: "password123",
    mobile: "9876543210",
    ...overrides,
  };
  const res = await request(app).post("/api/auth/signup").send(body);
  const cookie = (res.headers["set-cookie"] as unknown as string[] | undefined)?.[0]?.split(";")[0] ?? "";
  return { res, body, cookie, user: res.body as { _id: string; role: string } };
};

/** Creates a user via the API, then promotes it directly in the DB (as an operator would). */
export const createUserWithRole = async (role: "user" | "owner" | "deliveryBoy" | "admin") => {
  const created = await signUp();
  if (role !== "user") await mongoose.model("User").updateOne({ _id: created.user._id }, { role });
  return created;
};
