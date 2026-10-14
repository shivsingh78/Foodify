import { z } from "zod";
import { latitudeSchema, longitudeSchema, mobileSchema } from "./common.schema.js";
import { paginationSchema } from "./pagination.schema.js";

export const APPLICATION_ROLES = ["owner", "deliveryBoy"] as const;
export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

/** `needs_info` sends the application back to the applicant, who resubmits it. */
export const APPLICATION_STATUSES = ["pending", "needs_info", "approved", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const text = (label: string, max: number) => z.string().trim().min(1, `${label} is required`).max(max);

/** Multipart fields; the restaurant photo is uploaded as the `image` file. */
export const ownerApplicationSchema = z.strictObject({
  businessName: text("Restaurant name", 80).min(2, "Restaurant name must be at least 2 characters"),
  description: z.string().trim().max(500).optional(),
  contactPhone: mobileSchema,
  address: text("Address", 200),
  city: text("City", 60),
  state: text("State", 60),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type OwnerApplicationInput = z.infer<typeof ownerApplicationSchema>;

export const VEHICLE_TYPES = ["bicycle", "scooter", "motorcycle"] as const;

export const deliveryApplicationSchema = z
  .strictObject({
    contactPhone: mobileSchema,
    vehicleType: z.enum(VEHICLE_TYPES),
    // Bicycles have no registration; motorised vehicles must give one.
    vehicleNumber: z.string().trim().max(20).optional(),
    serviceArea: text("Service area", 100),
  })
  .refine((v) => v.vehicleType === "bicycle" || (v.vehicleNumber && v.vehicleNumber.length >= 4), {
    path: ["vehicleNumber"],
    message: "Vehicle registration number is required for motorised vehicles",
  });
export type DeliveryApplicationInput = z.infer<typeof deliveryApplicationSchema>;

export const reviewReasonSchema = z.strictObject({
  reason: z.string().trim().min(5, "Please give a reason (at least 5 characters)").max(500),
});
export type ReviewReasonInput = z.infer<typeof reviewReasonSchema>;

export const applicationListQuerySchema = paginationSchema.extend({
  role: z.enum(APPLICATION_ROLES).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;
