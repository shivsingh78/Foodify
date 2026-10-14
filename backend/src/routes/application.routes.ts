import express from "express";
import {
  applicationListQuerySchema,
  deliveryApplicationSchema,
  idParamSchema,
  ownerApplicationSchema,
  reviewReasonSchema,
} from "@foodify/validation";
import * as c from "../controllers/application.controller.js";
import { isAuth, requireRole } from "../middlewares/auth.js";
import { limits } from "../middlewares/rateLimit.js";
import { upload } from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";

const idParam = validate({ params: idParamSchema("applicationId") });

/** Applicant endpoints, mounted at /api/applications. */
export const applicationRouter = express.Router();
applicationRouter.use(isAuth, limits.applications);
applicationRouter.post("/owner", requireRole("user"), upload.single("image"), validate(ownerApplicationSchema), c.submitOwner);
applicationRouter.post("/delivery-partner", requireRole("user"), validate(deliveryApplicationSchema), c.submitDelivery);
applicationRouter.get("/mine", c.mine);
// Resubmission is validated in the service because the schema depends on the stored role.
applicationRouter.post("/:applicationId/resubmit", requireRole("user"), upload.single("image"), idParam, c.resubmit);
applicationRouter.get("/:applicationId", idParam, c.getOne);

/** Administrator endpoints, mounted at /api/admin/applications. Every route requires role=admin. */
export const adminApplicationRouter = express.Router();
adminApplicationRouter.use(isAuth, requireRole("admin"), limits.applications);
adminApplicationRouter.get("/", validate({ query: applicationListQuerySchema }), c.adminList);
adminApplicationRouter.post("/:applicationId/approve", idParam, c.approve);
adminApplicationRouter.post("/:applicationId/reject", idParam, validate(reviewReasonSchema), c.reject);
adminApplicationRouter.post("/:applicationId/request-info", idParam, validate(reviewReasonSchema), c.requestInfo);
