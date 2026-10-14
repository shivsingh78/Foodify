import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProduction } from "./config/env.js";
import { cacheStats } from "./services/cache.service.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.js";
import { limits } from "./middlewares/rateLimit.js";
import { AppError } from "./utils/AppError.js";
import analyticsRouter from "./routes/analytics.routes.js";
import authRouter from "./routes/auth.routes.js";
import geoRouter from "./routes/geo.routes.js";
import { adminApplicationRouter, applicationRouter } from "./routes/application.routes.js";
import itemRouter from "./routes/item.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import orderRouter from "./routes/order.routes.js";
import shopRouter from "./routes/shop.routes.js";
import userRouter from "./routes/user.routes.js";

export const allowedOrigins: string[] = [
  env.FRONTEND_URL,
  ...(isProduction
    ? []
    : ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"]),
].filter((origin): origin is string => Boolean(origin));

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie auth: browsers always send `Origin` on cross-site
 * state-changing requests, so reject any that come from an unknown origin.
 */
const rejectForeignOrigin = (req: Request, _res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (!SAFE_METHODS.has(req.method) && origin && !allowedOrigins.includes(origin)) {
    throw AppError.forbidden("Origin not allowed");
  }
  next();
};

export const createApp = (): Express => {
  const app = express();

  // Required so rate limiting sees the real client IP behind a reverse proxy.
  if (isProduction) app.set("trust proxy", 1);

  app.use(helmet());
  if (env.NODE_ENV === "development") app.use(morgan("dev"));

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(rejectForeignOrigin);
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", cache: cacheStats });
  });

  app.use("/api", limits.api);
  app.use("/api/auth", authRouter);
  app.use("/api/user", userRouter);
  app.use("/api/shop", shopRouter);
  app.use("/api/item", itemRouter);
  app.use("/api/order", orderRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/geo", geoRouter);
  app.use("/api/applications", applicationRouter);
  app.use("/api/admin/applications", adminApplicationRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
