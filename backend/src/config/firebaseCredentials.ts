import { createPrivateKey } from "node:crypto";

const BEGIN = "-----BEGIN PRIVATE KEY-----";
const END = "-----END PRIVATE KEY-----";

/**
 * Env files store the PEM on one line with literal `\n` sequences, often wrapped in quotes.
 * Returns the key with real newlines. Never logs the value.
 */
export const normalizePrivateKey = (raw: string): string =>
  raw
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    .trim();

/** Returns human-readable problems (never including the key itself). Empty array = valid. */
export const validateFirebaseCredentials = (creds: {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
}): string[] => {
  const problems: string[] = [];
  const { projectId, clientEmail, privateKey } = creds;

  if (!projectId) problems.push("FIREBASE_PROJECT_ID is missing");
  if (!clientEmail) problems.push("FIREBASE_CLIENT_EMAIL is missing");
  if (!privateKey) problems.push("FIREBASE_PRIVATE_KEY is missing");

  if (projectId && clientEmail && !clientEmail.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    problems.push(
      `FIREBASE_CLIENT_EMAIL must be the service-account "client_email" of project "${projectId}" ` +
        `(it ends with @${projectId}.iam.gserviceaccount.com); all three values must come from the same JSON key file`,
    );
  }

  if (privateKey) {
    const key = normalizePrivateKey(privateKey);
    if (!key.startsWith(BEGIN) || !key.endsWith(END)) {
      problems.push(
        `FIREBASE_PRIVATE_KEY is not a complete PEM (expected it to start with "${BEGIN}" and end with "${END}"; ` +
          `got ${key.length} characters). Copy the whole "private_key" value from the service-account JSON`,
      );
    } else {
      try {
        createPrivateKey(key);
      } catch {
        problems.push("FIREBASE_PRIVATE_KEY has PEM markers but its contents cannot be parsed (truncated or corrupted)");
      }
    }
  }
  return problems;
};
