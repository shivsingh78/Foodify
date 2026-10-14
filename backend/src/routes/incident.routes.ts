import express from "express";
import { z } from "zod";
import { idParamSchema, objectIdSchema, paginationSchema } from "@foodify/validation";
import * as c from "../controllers/incident.controller.js";
import { isAuth, requireRole } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { ANOMALY_TYPES, INCIDENT_STATUSES } from "../models/orchestrationIncident.model.js";

const listQuery = paginationSchema.extend({
  status: z.enum(INCIDENT_STATUSES).optional(),
  anomalyType: z.enum(ANOMALY_TYPES).optional(),
});
const resolveBody = z.strictObject({ reason: z.string().trim().min(3, "Please give a reason").max(500) });
const backlogBody = z.strictObject({ orderId: objectIdSchema, shopOrderId: objectIdSchema });
const idParam = validate({ params: idParamSchema("incidentId") });

/** Order-incident administration, mounted at /api/admin/incidents. Every route requires role=admin. */
const router = express.Router();
router.use(isAuth, requireRole("admin"));
router.get("/", validate({ query: listQuery }), c.list);
router.get("/metrics", c.metrics);
router.get("/backlog", validate({ query: paginationSchema }), c.backlog);
router.post("/backlog/process", validate(backlogBody), c.processBacklog);
router.get("/:incidentId", idParam, c.getOne);
router.post("/:incidentId/resolve", validate({ params: idParamSchema("incidentId"), body: resolveBody }), c.resolve);
router.post("/:incidentId/retry", idParam, c.retry);

export default router;
