import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// backend/dist/app.js -> <repo>/frontend/dist (the layout used by the Docker image too).
const defaultFrontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

/** Directory of the built SPA to serve, or undefined when there is none (API-only deployment). */
const resolveFrontendDir = (explicit?: string): string | undefined => {
  const dir = explicit ?? env.FRONTEND_DIST ?? (isProduction ? defaultFrontendDir : undefined);
  return dir && existsSync(path.join(dir, "index.html")) ? dir : undefined;
};

export const createApp = (options: { frontendDir?: string } = {}): Express => {
  const app = express();
  const frontendDir = resolveFrontendDir(options.frontendDir);

  // Required so rate limiting sees the real client IP behind a reverse proxy.
  if (isProduction) app.set("trust proxy", 1);

  app.use(
    helmet({
      // The SPA loads Razorpay, OpenStreetMap tiles and Cloudinary images, which helmet's default
      // CSP would block, so it is only relaxed when the SPA is served from here.
      contentSecurityPolicy: frontendDir ? false : undefined,
      // Firebase Google sign-in uses a popup, which "same-origin" would sever.
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    }),
  );
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

  // Unknown API paths must stay JSON 404s and never fall through to the SPA.
  app.use("/api", notFoundHandler);

  if (frontendDir) {
    app.use("/assets", express.static(path.join(frontendDir, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(frontendDir, { index: false }));
    // History fallback for client-side routes (BrowserRouter): only for page navigations.
    app.get(/^(?!\/socket\.io\/)/, (req, res, next) => {
      if (path.extname(req.path) || !req.accepts("html")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(frontendDir, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
