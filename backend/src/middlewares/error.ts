import { unlink } from "node:fs/promises";
import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { isProduction } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000;

const isMalformedJson = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";

/** Single place where errors become HTTP responses. Never leaks internals in production. */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // Do not leave rejected uploads behind in the temp directory.
  if (req.file?.path) void unlink(req.file.path).catch(() => undefined);

  if (error instanceof AppError) {
    res.status(error.status).json({
      message: error.message,
      ...(error.code && { code: error.code }),
      ...(error.details !== undefined && { errors: error.details }),
    });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({ message: error.message, code: "UPLOAD_REJECTED" });
    return;
  }
  if (isMalformedJson(error)) {
    res.status(400).json({ message: "Malformed JSON body" });
    return;
  }
  if (isDuplicateKeyError(error)) {
    res.status(409).json({ message: "A record with these details already exists" });
    return;
  }
  if (error instanceof Error && error.message === "Not allowed by CORS") {
    res.status(403).json({ message: "Origin not allowed" });
    return;
  }

  console.error("Unhandled error:", error);
  res.status(500).json({
    message: "Something went wrong. Please try again later.",
    ...(!isProduction && error instanceof Error && { debug: error.message }),
  });
};
