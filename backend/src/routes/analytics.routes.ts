import express from "express";
import { analyticsQuerySchema } from "@foodify/validation";
import { dispatchMetrics, ownerAnalytics } from "../controllers/analytics.controller.js";
import { isAuth, requireRole } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";

const analyticsRouter = express.Router();

analyticsRouter.get("/owner", isAuth, requireRole("owner"), validate({ query: analyticsQuerySchema }), ownerAnalytics);

// Internal operational metrics: administrators only. Counts and durations, no personal data.
analyticsRouter.get("/dispatch", isAuth, requireRole("admin"), validate({ query: analyticsQuerySchema }), dispatchMetrics);

export default analyticsRouter;
