import express from "express";
import { updateLocationSchema } from "@foodify/validation";
import { getCurrentUser, updateLocation } from "../controllers/user.controller.js";
import { isAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";

const userRouter = express.Router();

userRouter.get("/current", isAuth, getCurrentUser);
userRouter.post("/update-location", isAuth, validate(updateLocationSchema), updateLocation);

export default userRouter;
