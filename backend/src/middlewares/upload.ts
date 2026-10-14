import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import multer from "multer";
import { AppError } from "../utils/AppError.js";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

// Random temp names: client-supplied filenames are never used on disk.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpdir()),
  filename: (_req, file, cb) =>
    cb(null, `foodify-${randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0, 6)}`),
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new AppError(400, "Only JPEG, PNG, WebP or AVIF images are allowed", "INVALID_FILE_TYPE"));
  },
});
