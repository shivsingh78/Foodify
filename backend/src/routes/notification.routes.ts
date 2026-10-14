import express from "express";
import { idParamSchema, notificationListQuerySchema } from "@foodify/validation";
import { list, markAllRead, markRead } from "../controllers/notification.controller.js";
import { isAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";

const notificationRouter = express.Router();

notificationRouter.get("/", isAuth, validate({ query: notificationListQuerySchema }), list);
notificationRouter.post("/read-all", isAuth, markAllRead);
notificationRouter.post(
  "/:notificationId/read",
  isAuth,
  validate({ params: idParamSchema("notificationId") }),
  markRead,
);

export default notificationRouter;
