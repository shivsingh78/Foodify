import { v2 as cloudinary } from "cloudinary";
import { unlink } from "node:fs/promises";
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";

let configured = false;

const removeLocalFile = (path: string) => unlink(path).catch(() => undefined);

/** Uploads a local temp file to Cloudinary and always removes the temp file. */
export const uploadOnCloudinary = async (filePath: string): Promise<string> => {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    await removeLocalFile(filePath);
    throw new AppError(503, "Image upload is not configured on the server", "CLOUDINARY_NOT_CONFIGURED");
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    });
    configured = true;
  }
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: "food-items",
      unique_filename: true,
      overwrite: false,
      resource_type: "image",
    });
    return result.secure_url;
  } catch (error) {
    console.error("Cloudinary upload failed:", error instanceof Error ? error.message : error);
    throw new AppError(502, "Image upload failed. Please try again.", "UPLOAD_FAILED");
  } finally {
    await removeLocalFile(filePath);
  }
};

/** Extracts the public id from a Cloudinary delivery URL (folder/name, no extension). */
const publicIdFromUrl = (url: string): string | null => {
  const match = /\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/.exec(url);
  return match?.[1] ?? null;
};

/** Best-effort cleanup of a replaced/deleted image; never fails the request. */
export const deleteFromCloudinary = async (url: string | undefined | null): Promise<void> => {
  if (!url || !configured || !url.includes("res.cloudinary.com")) return;
  const publicId = publicIdFromUrl(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.warn("Cloudinary cleanup failed:", error instanceof Error ? error.message : error);
  }
};
