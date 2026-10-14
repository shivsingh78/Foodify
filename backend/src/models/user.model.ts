import mongoose, { type HydratedDocument } from "mongoose";

export type UserRole = "user" | "owner" | "deliveryBoy" | "admin";

export interface IDeliveryProfile {
  vehicleType: string;
  vehicleNumber?: string;
  serviceArea: string;
  approvedAt: Date;
}

export interface IPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface IUser {
  fullName: string;
  email: string;
  password?: string;
  /** Empty for accounts created through Google until the user adds one. */
  mobile: string;
  profileImage?: string;
  role: UserRole;
  /** SHA-256 hash of the pending password-reset OTP (never the OTP itself). */
  resetOtp?: string | null;
  otpExpires?: Date | null;
  otpAttempts: number;
  otpLastSentAt?: Date | null;
  isOtpVerified: boolean;
  /** `jti` of the only reset token that may currently be redeemed. */
  resetTokenId?: string | null;
  isOnline: boolean;
  /** Firebase UID, linked on the first verified Google sign-in/up. */
  googleUid?: string | null;
  location: IPoint;
  /** When `location` was last reported by the app/socket; dispatch ignores stale positions. */
  locationUpdatedAt?: Date | null;
  /** Set when a delivery-partner application is approved. */
  deliveryProfile?: IDeliveryProfile;
}

export type UserDocument = HydratedDocument<IUser>;

/** Fields that must never leave the server. */
const PRIVATE_FIELDS = [
  "password",
  "resetOtp",
  "otpExpires",
  "otpAttempts",
  "otpLastSentAt",
  "isOtpVerified",
  "resetTokenId",
  "googleUid",
] as const;

const userSchema = new mongoose.Schema<IUser>(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    mobile: { type: String, default: "" },
    profileImage: { type: String },
    role: { type: String, enum: ["user", "owner", "deliveryBoy", "admin"], required: true },
    locationUpdatedAt: { type: Date, default: null },
    deliveryProfile: {
      vehicleType: String,
      vehicleNumber: String,
      serviceArea: String,
      approvedAt: Date,
    },
    resetOtp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpLastSentAt: { type: Date, select: false },
    isOtpVerified: { type: Boolean, default: false, select: false },
    resetTokenId: { type: String, select: false },
    isOnline: { type: Boolean, default: false },
    googleUid: { type: String, select: false },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        for (const field of PRIVATE_FIELDS) delete (ret as Record<string, unknown>)[field];
        return ret;
      },
    },
  },
);

userSchema.index({ location: "2dsphere" });
// One account per Google identity; guards against concurrent first sign-ins.
userSchema.index({ googleUid: 1 }, { unique: true, partialFilterExpression: { googleUid: { $type: "string" } } });
userSchema.index({ role: 1, isOnline: 1 });

const User = mongoose.model<IUser>("User", userSchema);

export default User;
