import { Resend } from "resend";
import { env } from "../config/env.js";
import { AppError } from "./AppError.js";

const SEND_TIMEOUT_MS = 8000;

let client: Resend | null = null;

const getClient = (): { resend: Resend; from: string } => {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new AppError(503, "Email delivery is not configured on the server", "EMAIL_NOT_CONFIGURED");
  }
  client ??= new Resend(env.RESEND_API_KEY);
  return { resend: client, from: env.EMAIL_FROM };
};

const FAILED = () => new AppError(502, "Could not send email. Please try again later.", "EMAIL_FAILED");

/**
 * Resend answers 403 when the sender is not allowed: either the "from" domain is not verified,
 * or (test sender onboarding@resend.dev) the recipient is not the Resend account owner.
 * It is an operator problem, so the log says what to fix; the client gets a generic message.
 */
const SENDER_NOT_ALLOWED = () =>
  new AppError(502, "We couldn't send the email right now. Please contact support if this continues.", "EMAIL_SENDER_NOT_ALLOWED");

/**
 * Resolves only once Resend has ACCEPTED the message (it returned an id). Every other outcome
 * throws a generic 502 so callers can roll back state; provider details are logged by code only
 * (never the key, the recipient, or the message body).
 */
const send = async (to: string, subject: string, html: string): Promise<void> => {
  const { resend, from } = getClient();

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("EMAIL_TIMEOUT")), SEND_TIMEOUT_MS);
  });

  try {
    const { data, error } = await Promise.race([resend.emails.send({ from, to, subject, html }), timeout]);
    if (error || !data?.id) {
      console.error(`Email provider rejected the request: ${error?.name ?? "no_message_id"} (HTTP ${error?.statusCode ?? "n/a"})`);
      if (error?.statusCode === 403) {
        console.error(
          "Email sender/domain problem: Resend only allows the test sender (onboarding@resend.dev) to email your own Resend " +
            "account address. To email other users, verify a domain at https://resend.com/domains and set EMAIL_FROM to an address on it.",
        );
        throw SENDER_NOT_ALLOWED();
      }
      if (error?.statusCode === 401 || error?.name === "invalid_api_key" || error?.name === "restricted_api_key") {
        console.error("Email provider authentication problem: check RESEND_API_KEY (needs sending access).");
      }
      throw FAILED();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const reason = error instanceof Error && error.message === "EMAIL_TIMEOUT" ? "timeout" : "network_error";
    console.error(`Email delivery failed: ${reason}`);
    throw FAILED();
  } finally {
    clearTimeout(timer);
  }
};

export const sendOtpMail = (to: string, otp: string) =>
  send(to, "Reset Your Password", `<p>Your OTP for password reset is <b>${otp}</b>. It expires in 5 minutes.</p>`);

export const sendDeliveryOtpMail = (to: string, otp: string) =>
  send(to, "Delivery OTP", `<p>Your OTP for delivery is <b>${otp}</b>. It expires in 5 minutes.</p>`);
