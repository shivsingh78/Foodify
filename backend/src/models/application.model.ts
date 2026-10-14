import mongoose, { type HydratedDocument, type Types } from "mongoose";
import {
  APPLICATION_ROLES,
  APPLICATION_STATUSES,
  type ApplicationRole,
  type ApplicationStatus,
  type DeliveryApplicationInput,
  type OwnerApplicationInput,
} from "@foodify/validation";

export interface IRoleApplication {
  user: Types.ObjectId;
  role: ApplicationRole;
  status: ApplicationStatus;
  /** True only while the application is open (pending / needs_info); see the unique index. */
  active?: true;
  ownerData?: OwnerApplicationInput & { image: string };
  deliveryData?: DeliveryApplicationInput;
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  /** Rejection reason or the information the admin asked for. */
  reviewNote?: string | null;
  provisioning: {
    state: "idle" | "in_progress" | "failed" | "done";
    startedAt?: Date | null;
    /** Machine-readable failure code only; never raw error text. */
    error?: string | null;
  };
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type RoleApplicationDocument = HydratedDocument<IRoleApplication>;

const schema = new mongoose.Schema<IRoleApplication>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: APPLICATION_ROLES, required: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: "pending", required: true },
    active: { type: Boolean },
    ownerData: {
      businessName: String,
      description: String,
      contactPhone: String,
      address: String,
      city: String,
      state: String,
      latitude: Number,
      longitude: Number,
      image: String,
    },
    deliveryData: {
      contactPhone: String,
      vehicleType: String,
      vehicleNumber: String,
      serviceArea: String,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null },
    provisioning: {
      state: { type: String, enum: ["idle", "in_progress", "failed", "done"], default: "idle" },
      startedAt: { type: Date, default: null },
      error: { type: String, default: null },
    },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// A user can have at most one open application, so duplicates and
// owner-and-delivery double applications are impossible even under races.
schema.index({ user: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ status: 1, role: 1, submittedAt: -1 });

const RoleApplication = mongoose.model<IRoleApplication>("RoleApplication", schema);
export default RoleApplication;
