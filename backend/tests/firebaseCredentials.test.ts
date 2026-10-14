import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePrivateKey, validateFirebaseCredentials } from "../src/config/firebaseCredentials.js";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const projectId = "foodify-62c48";
const clientEmail = `firebase-adminsdk-abc@${projectId}.iam.gserviceaccount.com`;

describe("Firebase credential validation", () => {
  it("accepts a valid key written with escaped newlines, with or without quotes", () => {
    const escaped = pem.trim().replace(/\n/g, "\\n");
    for (const value of [escaped, `"${escaped}"`, `'${escaped}'`, pem]) {
      expect(validateFirebaseCredentials({ projectId, clientEmail, privateKey: value })).toEqual([]);
    }
    expect(normalizePrivateKey(`"${pem.trim().replace(/\n/g, "\\n")}"`)).toBe(pem.trim());
  });

  it("rejects a short or placeholder key without echoing it", () => {
    const secretLooking = "not-a-real-key-but-pretend-secret-123";
    const problems = validateFirebaseCredentials({ projectId, clientEmail, privateKey: secretLooking });
    expect(problems.join(" ")).toMatch(/not a complete PEM/);
    expect(problems.join(" ")).not.toContain(secretLooking);
  });

  it("rejects a truncated PEM", () => {
    const truncated = pem.slice(0, 200) + "\n-----END PRIVATE KEY-----";
    expect(validateFirebaseCredentials({ projectId, clientEmail, privateKey: truncated }).join(" ")).toMatch(/cannot be parsed/);
  });

  it("requires the email to belong to the same project as the project id", () => {
    expect(validateFirebaseCredentials({ projectId, clientEmail: "someone@gmail.com", privateKey: pem }).join(" ")).toMatch(
      /same JSON key file/,
    );
    expect(
      validateFirebaseCredentials({ projectId, clientEmail: "x@foodify-95238.iam.gserviceaccount.com", privateKey: pem }),
    ).not.toEqual([]);
  });

  it("reports every missing value", () => {
    expect(validateFirebaseCredentials({})).toHaveLength(3);
  });
});
