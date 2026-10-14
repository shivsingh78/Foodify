import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { AppError } from "../utils/AppError.js";

type Schemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

const fail = (error: z.ZodError) =>
  new AppError(
    400,
    error.issues[0]?.message ?? "Validation failed",
    "VALIDATION_FAILED",
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );

/**
 * Validates and normalises request input with shared Zod schemas.
 * A bare schema is shorthand for `{ body: schema }`.
 */
export const validate = (schemas: z.ZodType | Schemas) => {
  const config: Schemas =
    "safeParse" in schemas ? { body: schemas as z.ZodType } : (schemas as Schemas);

  return (req: Request, _res: Response, next: NextFunction) => {
    if (config.body) {
      const result = config.body.safeParse(req.body ?? {});
      if (!result.success) throw fail(result.error);
      req.body = result.data;
    }
    if (config.params) {
      const result = config.params.safeParse(req.params);
      if (!result.success) throw fail(result.error);
      req.params = result.data as typeof req.params;
    }
    if (config.query) {
      const result = config.query.safeParse(req.query);
      if (!result.success) throw fail(result.error);
      req.validatedQuery = result.data;
    }
    next();
  };
};

/** Typed accessor for the output of the `query` schema passed to `validate`. */
export const validatedQuery = <T>(req: Request): T => req.validatedQuery as T;
