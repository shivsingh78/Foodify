import {
  buildPaginationMeta,
  deliveryApplicationSchema,
  ownerApplicationSchema,
  type ApplicationListQuery,
  type ApplicationRole,
  type NotificationType,
} from "@foodify/validation";
import RoleApplication, { type RoleApplicationDocument } from "../models/application.model.js";
import Shop from "../models/shop.model.js";
import User, { type UserRole } from "../models/user.model.js";
import { AppError } from "../utils/AppError.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { escapeRegex } from "../utils/crypto.js";
import { invalidateCache } from "./cache.service.js";
import { notify } from "./notification.service.js";

/** A claim older than this is considered abandoned (e.g. the process crashed mid-approval). */
const CLAIM_TTL_MS = 2 * 60 * 1000;

const isDuplicateKey = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000;

const ROLE_LABEL: Record<ApplicationRole, string> = { owner: "restaurant owner", deliveryBoy: "delivery partner" };

const parseData = (role: ApplicationRole, body: unknown) => {
  const schema = role === "owner" ? ownerApplicationSchema : deliveryApplicationSchema;
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0]?.message ?? "Validation failed", "VALIDATION_FAILED");
  }
  return result.data;
};

/* ------------------------------ applicant side ------------------------------ */

export const submitApplication = async (
  userId: string,
  role: ApplicationRole,
  body: unknown,
  imagePath?: string,
) => {
  const data = parseData(role, body);
  const user = await User.findById(userId).select("role");
  if (!user) throw AppError.unauthorized();
  // Roles are exclusive: only a customer can apply, and an owner cannot also become a rider.
  if (user.role !== "user") {
    throw AppError.conflict("Only customer accounts can apply for a new role", "ROLE_NOT_ELIGIBLE");
  }
  if (await RoleApplication.exists({ user: userId, active: true })) {
    throw AppError.conflict("You already have an application under review", "APPLICATION_ALREADY_ACTIVE");
  }
  if (role === "owner" && !imagePath) throw AppError.badRequest("A restaurant photo is required", "IMAGE_REQUIRED");

  const image = role === "owner" && imagePath ? await uploadOnCloudinary(imagePath) : undefined;
  let application: RoleApplicationDocument;
  try {
    application = await RoleApplication.create({
      user: userId,
      role,
      status: "pending",
      active: true,
      ...(role === "owner" ? { ownerData: { ...(data as object), image } } : { deliveryData: data }),
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw AppError.conflict("You already have an application under review", "APPLICATION_ALREADY_ACTIVE");
    }
    throw error;
  }
  await notify({
    userId,
    type: "application_submitted",
    title: "Application received",
    message: `Your ${ROLE_LABEL[role]} application is pending review.`,
  });
  return application;
};

/** Applicant answers a `needs_info` request; the application returns to the review queue. */
export const resubmitApplication = async (userId: string, applicationId: string, body: unknown, imagePath?: string) => {
  const current = await RoleApplication.findOne({ _id: applicationId, user: userId });
  if (!current) throw AppError.notFound("Application not found");
  if (current.status !== "needs_info") {
    throw AppError.conflict("This application is not waiting for more information", "INVALID_STATE");
  }
  const data = parseData(current.role, body);
  const image = current.role === "owner" && imagePath ? await uploadOnCloudinary(imagePath) : undefined;

  const set =
    current.role === "owner"
      ? { ownerData: { ...(data as object), image: image ?? current.ownerData?.image } }
      : { deliveryData: data };
  const updated = await RoleApplication.findOneAndUpdate(
    { _id: applicationId, user: userId, status: "needs_info" },
    { $set: { ...set, status: "pending", submittedAt: new Date(), reviewNote: null } },
    { new: true },
  );
  if (!updated) throw AppError.conflict("This application is no longer awaiting information", "INVALID_STATE");
  return updated;
};

export const listMyApplications = (userId: string) =>
  RoleApplication.find({ user: userId }).sort({ createdAt: -1 }).limit(20).lean();

/** Visible to its applicant and to administrators only; anyone else gets a plain 404. */
export const getApplication = async (viewerId: string, viewerRole: UserRole, applicationId: string) => {
  const application = await RoleApplication.findById(applicationId).populate("user", "fullName email mobile").lean();
  const ownerId = String((application?.user as unknown as { _id?: unknown } | undefined)?._id ?? "");
  if (!application || (viewerRole !== "admin" && ownerId !== viewerId)) throw AppError.notFound("Application not found");
  return application;
};

/* ------------------------------ admin side ------------------------------ */

export const listApplications = async (q: ApplicationListQuery) => {
  const filter: Record<string, unknown> = {};
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.q) {
    const pattern = { $regex: escapeRegex(q.q), $options: "i" };
    const users = await User.find({ $or: [{ fullName: pattern }, { email: pattern }] }).select("_id").limit(200).lean();
    filter.user = { $in: users.map((u) => u._id) };
  }
  const [applications, total] = await Promise.all([
    RoleApplication.find(filter)
      .sort({ submittedAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate("user", "fullName email mobile")
      .lean(),
    RoleApplication.countDocuments(filter),
  ]);
  return { applications, pagination: buildPaginationMeta(q.page, q.limit, total) };
};

/** Explains why a review action found nothing to update. */
const explainStuckReview = async (applicationId: string) => {
  const app = await RoleApplication.findById(applicationId).lean();
  if (!app) return AppError.notFound("Application not found");
  if (app.status === "pending" && app.provisioning.state === "in_progress") {
    return AppError.conflict("Another review of this application is in progress", "REVIEW_IN_PROGRESS");
  }
  return AppError.conflict(`Application is already ${app.status.replace("_", " ")}`, "INVALID_STATE");
};

const notifyApplicant = (app: RoleApplicationDocument, type: NotificationType, title: string, message: string) =>
  notify({ userId: app.user, type, title, message });

const provisionOwner = async (app: RoleApplicationDocument) => {
  const data = app.ownerData;
  if (!data?.image) throw new Error("INCOMPLETE_APPLICATION");
  const user = await User.findById(app.user).select("role");
  if (!user || (user.role !== "user" && user.role !== "owner")) throw new Error("ROLE_CONFLICT");

  // Idempotent: a retry finds the shop created by the failed attempt instead of adding another.
  await Shop.findOneAndUpdate(
    { owner: app.user },
    {
      $setOnInsert: {
        name: data.businessName,
        image: data.image,
        city: data.city,
        state: data.state,
        address: data.address,
        description: data.description,
        contactPhone: data.contactPhone,
        location: { type: "Point", coordinates: [data.longitude, data.latitude] },
        items: [],
      },
    },
    { upsert: true },
  );
  const result = await User.updateOne({ _id: app.user, role: { $in: ["user", "owner"] } }, { role: "owner" });
  if (result.matchedCount !== 1) throw new Error("ROLE_CONFLICT");
  await Promise.all([invalidateCache("shops:"), invalidateCache("items:")]);
};

const provisionDelivery = async (app: RoleApplicationDocument) => {
  const data = app.deliveryData;
  if (!data) throw new Error("INCOMPLETE_APPLICATION");
  const result = await User.updateOne(
    { _id: app.user, role: { $in: ["user", "deliveryBoy"] } },
    {
      role: "deliveryBoy",
      mobile: data.contactPhone,
      deliveryProfile: {
        vehicleType: data.vehicleType,
        vehicleNumber: data.vehicleNumber,
        serviceArea: data.serviceArea,
        approvedAt: new Date(),
      },
    },
  );
  if (result.matchedCount !== 1) throw new Error("ROLE_CONFLICT");
};

/**
 * Approval is a claim → provision → finalise sequence:
 *  - the claim is an atomic conditional update, so two admins (or a double click) cannot both run it;
 *  - provisioning is idempotent, so retrying after a crash or failure is safe;
 *  - the application only becomes `approved` after the role and profile exist.
 * A failed attempt leaves the application `pending` with provisioning.state = "failed".
 */
export const approveApplication = async (adminId: string, applicationId: string) => {
  const claimed = await RoleApplication.findOneAndUpdate(
    {
      _id: applicationId,
      status: "pending",
      $or: [
        { "provisioning.state": { $ne: "in_progress" } },
        { "provisioning.startedAt": { $lt: new Date(Date.now() - CLAIM_TTL_MS) } },
      ],
    },
    { $set: { "provisioning.state": "in_progress", "provisioning.startedAt": new Date(), "provisioning.error": null, reviewedBy: adminId } },
    { new: true },
  );

  if (!claimed) {
    const existing = await RoleApplication.findById(applicationId);
    // Repeating an approval that already succeeded is a harmless no-op.
    if (existing?.status === "approved") return { application: existing, alreadyApproved: true };
    throw await explainStuckReview(applicationId);
  }

  try {
    await (claimed.role === "owner" ? provisionOwner(claimed) : provisionDelivery(claimed));
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PROVISIONING_FAILED";
    console.error(`Provisioning failed for application ${applicationId}: ${code}`);
    await RoleApplication.updateOne({ _id: applicationId }, { "provisioning.state": "failed", "provisioning.error": code });
    throw new AppError(code === "ROLE_CONFLICT" ? 409 : 502, "Could not activate this account. The application stays pending; retry or reject it.", code);
  }

  const approved = await RoleApplication.findOneAndUpdate(
    { _id: applicationId, status: "pending" },
    { $set: { status: "approved", reviewedBy: adminId, reviewedAt: new Date(), "provisioning.state": "done", "provisioning.error": null }, $unset: { active: "" } },
    { new: true },
  );
  if (!approved) throw AppError.conflict("Application changed during approval", "INVALID_STATE");

  await notifyApplicant(approved, "application_approved", "Application approved", `You are now a ${ROLE_LABEL[approved.role]}. Reload Foodify to get started.`);
  return { application: approved, alreadyApproved: false };
};

const reviewWithReason = async (
  adminId: string,
  applicationId: string,
  reason: string,
  outcome: "rejected" | "needs_info",
) => {
  const updated = await RoleApplication.findOneAndUpdate(
    { _id: applicationId, status: "pending", "provisioning.state": { $ne: "in_progress" } },
    {
      $set: { status: outcome, reviewedBy: adminId, reviewedAt: new Date(), reviewNote: reason },
      // A rejected application closes (so the user may apply again); needs_info stays open.
      ...(outcome === "rejected" && { $unset: { active: "" } }),
    },
    { new: true },
  );
  if (!updated) throw await explainStuckReview(applicationId);

  if (outcome === "rejected") {
    await notifyApplicant(updated, "application_rejected", "Application not approved", `Reason: ${reason}`);
  } else {
    await notifyApplicant(updated, "application_needs_info", "More information needed", reason);
  }
  return updated;
};

export const rejectApplication = (adminId: string, id: string, reason: string) => reviewWithReason(adminId, id, reason, "rejected");
export const requestMoreInfo = (adminId: string, id: string, reason: string) => reviewWithReason(adminId, id, reason, "needs_info");

