import express from "express";
import { geoAutocompleteQuerySchema, geoReverseQuerySchema } from "@foodify/validation";
import { autocomplete, reverse } from "../controllers/geo.controller.js";
import { isAuth } from "../middlewares/auth.js";
import { limits } from "../middlewares/rateLimit.js";
import { validate } from "../middlewares/validate.js";

const geoRouter = express.Router();

geoRouter.get("/autocomplete", isAuth, limits.geo, validate({ query: geoAutocompleteQuerySchema }), autocomplete);
geoRouter.get("/reverse", isAuth, limits.geo, validate({ query: geoReverseQuerySchema }), reverse);

export default geoRouter;
