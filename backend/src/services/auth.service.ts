import bcrypt from "bcryptjs";
import type {
  GoogleAuthInput,
  ResetPasswordInput,
  SendOtpInput,
  SignInInput,
  SignUpInput,
  VerifyOtpInput,
} from "@foodify/validation";
import { OTP_LENGTH } from "@foodify/validation";
import { getFirebaseAuth } from "../config/firebase.js";
import User, { type UserDocument } from "../models/user.model.js";
import { AppError } from "../utils/AppError.js";
import { generateNumericCode, safeEqual, sha256 } from "../utils/crypto.js";
import { sendOtpMail } from "../utils/mail.js";
import { signPurposeToken, verifyToken } from "../utils/token.js";

const BCRYPT_ROUNDS = 10;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Compared against when the account does not exist so response time does not
// reveal whether an email is registered.
const DUMMY_HASH = bcrypt.hashSync("foodify-dummy-password", BCRYPT_ROUNDS);

const INVALID_CREDENTIALS = () => AppError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
const INVALID_OTP = () => AppError.badRequest("Invalid or expired OTP", "INVALID_OTP");
const INVALID_RESET_TOKEN = () => AppError.unauthorized("Invalid or expired reset token", "INVALID_RESET_TOKEN");

const isDuplicateKey = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000;

export const signUpUser = async (input: SignUpInput): Promise<UserDocument> => {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    // The role is fixed server-side. Owners/delivery partners are promoted by an operator.
    return await User.create({
      fullName: input.fullName,
      email: input.email,
      mobile: input.mobile,
      role: "user",
      password: passwordHash,
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw AppError.conflict("User already exists", "USER_ALREADY_EXISTS");
    throw error;
  }
};

export const signInUser = async (input: SignInInput): Promise<UserDocument> => {
  const user = await User.findOne({ email: input.email }).select("+password");
  // Accounts created via Google have no local password.
  const hash = user?.password ?? DUMMY_HASH;
  const matches = await bcrypt.compare(input.password, hash);
  if (!user || !user.password || !matches) throw INVALID_CREDENTIALS();
  return user;
};

/**
 * Always resolves the same way whether or not the account exists, so the
 * endpoint cannot be used to enumerate registered emails.
 */
export const sendOtpUser = async (input: SendOtpInput): Promise<void> => {
  const user = await User.findOne({ email: input.email }).select("+otpLastSentAt");
  if (!user) return;

  if (user.otpLastSentAt && Date.now() - user.otpLastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return; // cooldown: silently ignore repeated requests
  }

  const otp = generateNumericCode(OTP_LENGTH);
  await User.updateOne(
    { _id: user._id },
    {
      resetOtp: sha256(otp),
      otpExpires: new Date(Date.now() + OTP_TTL_MS),
      otpAttempts: 0,
      otpLastSentAt: new Date(),
      isOtpVerified: false,
      resetTokenId: null,
    },
  );
  try {
    await sendOtpMail(user.email, otp);
  } catch (error) {
    // An OTP that was never delivered must not stay valid, and the cooldown must not block a retry.
    await User.updateOne(
      { _id: user._id, resetOtp: sha256(otp) },
      { resetOtp: null, otpExpires: null, otpLastSentAt: null },
    );
    throw error;
  }
};

export const verifyUserOtp = async (input: VerifyOtpInput): Promise<{ resetToken: string }> => {
  const user = await User.findOne({ email: input.email }).select(
    "+resetOtp +otpExpires +otpAttempts",
  );
  if (!user || !user.resetOtp || !user.otpExpires || user.otpExpires.getTime() < Date.now()) {
    throw INVALID_OTP();
  }

  // Count the attempt atomically before comparing so parallel guesses cannot bypass the limit.
  const attempted = await User.findOneAndUpdate(
    { _id: user._id, resetOtp: user.resetOtp, otpAttempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { otpAttempts: 1 } },
    { new: true },
  ).select("+resetOtp");
  if (!attempted?.resetOtp) {
    // Too many attempts: burn the OTP so a new one must be requested.
    await User.updateOne({ _id: user._id }, { resetOtp: null, otpExpires: null });
    throw INVALID_OTP();
  }

  if (!safeEqual(attempted.resetOtp, sha256(input.otp))) throw INVALID_OTP();

  const { token, tokenId } = signPurposeToken(user._id.toString(), "password_reset", "5m");
  // Consume the OTP (single use) and bind the reset token to this verification.
  const consumed = await User.updateOne(
    { _id: user._id, resetOtp: attempted.resetOtp },
    { resetOtp: null, otpExpires: null, otpAttempts: 0, isOtpVerified: true, resetTokenId: tokenId },
  );
  if (consumed.modifiedCount !== 1) throw INVALID_OTP();

  return { resetToken: token };
};

export const resetUserPassword = async (input: ResetPasswordInput): Promise<void> => {
  let payload;
  try {
    payload = verifyToken(input.resetToken);
  } catch {
    throw INVALID_RESET_TOKEN();
  }
  if (payload.purpose !== "password_reset" || !payload.jti) throw INVALID_RESET_TOKEN();

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  // Atomic redeem: only the token issued by the latest OTP verification works, exactly once.
  const result = await User.updateOne(
    { _id: payload.userId, email: input.email, resetTokenId: payload.jti, isOtpVerified: true },
    { password: passwordHash, isOtpVerified: false, resetTokenId: null, otpAttempts: 0 },
  );
  if (result.modifiedCount !== 1) throw INVALID_RESET_TOKEN();
};

type VerifiedGoogleIdentity = { uid: string; email: string; name?: string; picture?: string };

const FIREBASE_ERROR_MAP: Record<string, () => AppError> = {
  "auth/user-disabled": () => AppError.forbidden("This Google account has been disabled", "ACCOUNT_DISABLED"),
  "auth/id-token-expired": () => AppError.unauthorized("Your Google session expired. Please try again.", "FIREBASE_TOKEN_EXPIRED"),
  "auth/id-token-revoked": () => AppError.unauthorized("Your Google session was revoked. Please sign in again.", "FIREBASE_TOKEN_REVOKED"),
};

/** Identity comes exclusively from the verified Firebase ID token. */
const verifyGoogleIdToken = async (idToken: string): Promise<VerifiedGoogleIdentity> => {
  const auth = getFirebaseAuth(); // throws 503 if Firebase is not configured
  let decoded;
  try {
    // checkRevoked also rejects tokens of disabled Firebase users.
    decoded = await auth.verifyIdToken(idToken, true);
  } catch (error) {
    const mapped = FIREBASE_ERROR_MAP[(error as { code?: string }).code ?? ""];
    throw mapped ? mapped() : AppError.unauthorized("Invalid Firebase authentication token", "INVALID_FIREBASE_TOKEN");
  }
  if (!decoded.email) throw AppError.badRequest("Firebase account does not contain an email", "FIREBASE_EMAIL_MISSING");
  if (!decoded.email_verified) throw AppError.forbidden("Firebase email is not verified", "FIREBASE_EMAIL_NOT_VERIFIED");
  return {
    uid: decoded.uid,
    email: decoded.email.trim().toLowerCase(),
    name: typeof decoded.name === "string" ? decoded.name : undefined,
    picture: typeof decoded.picture === "string" ? decoded.picture : undefined,
  };
};

/**
 * Finds the account for a verified Google identity, or null if none exists.
 *  1. By Firebase UID (stable identity).
 *  2. By email: only adopted when it is safe — the account has no local password and is not
 *     bound to another Google identity. A password account is never silently merged.
 */
const findAccountForIdentity = async (identity: VerifiedGoogleIdentity): Promise<UserDocument | null> => {
  const byUid = await User.findOne({ googleUid: identity.uid });
  if (byUid) return byUid;

  const byEmail = await User.findOne({ email: identity.email }).select("+googleUid +password");
  if (!byEmail) return null;

  if (byEmail.googleUid && byEmail.googleUid !== identity.uid) {
    throw AppError.unauthorized("This account is linked to a different Google identity", "GOOGLE_UID_MISMATCH");
  }
  if (!byEmail.googleUid && byEmail.password) {
    throw AppError.conflict(
      "An account with this email already exists. Sign in with your email and password instead.",
      "ACCOUNT_EXISTS_WITH_PASSWORD",
    );
  }

  // Password-less legacy/Google account without a stored UID: link it (conditional, so concurrent requests agree).
  await User.updateOne({ _id: byEmail._id, googleUid: null }, { googleUid: identity.uid }); // null also matches "missing"
  const linked = await User.findById(byEmail._id).select("+googleUid");
  if (linked?.googleUid !== identity.uid) {
    throw AppError.unauthorized("This account is linked to a different Google identity", "GOOGLE_UID_MISMATCH");
  }
  return linked;
};

/**
 * Google sign-in and sign-up in one step: an existing account signs in, an unknown verified
 * identity gets a new customer account. Safe under concurrency: the unique indexes on email
 * and googleUid decide the winner and the loser re-reads the winner's account.
 */
export const googleAuthUser = async (input: GoogleAuthInput): Promise<{ user: UserDocument; created: boolean }> => {
  const identity = await verifyGoogleIdToken(input.idToken);

  const existing = await findAccountForIdentity(identity);
  if (existing) return { user: existing, created: false };

  try {
    const user = await User.create({
      fullName: (identity.name ?? identity.email.split("@")[0] ?? "Foodify user").trim().slice(0, 80),
      email: identity.email,
      mobile: input.mobile ?? "",
      profileImage: identity.picture,
      role: "user", // never taken from the request
      googleUid: identity.uid,
    });
    return { user, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // Lost a race with a concurrent request for the same identity: use the account it created.
    const winner = await findAccountForIdentity(identity);
    if (!winner) throw error;
    return { user: winner, created: false };
  }
};
