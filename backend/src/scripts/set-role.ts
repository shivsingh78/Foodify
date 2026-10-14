/**
 * OPERATOR-ONLY tool (needs shell access and database credentials; there is no API for it).
 * Normal owner / delivery-partner onboarding goes through applications and admin approval.
 * Use this to bootstrap the FIRST admin, or to demote/repair an account. The account must exist.
 *
 *   pnpm --filter backend set-role <email> <user|owner|deliveryBoy>
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/user.model.js";

const ROLES = ["user", "owner", "deliveryBoy", "admin"] as const;
type Role = (typeof ROLES)[number];

const [email, role] = process.argv.slice(2);
if (!email || !role || !ROLES.includes(role as Role)) {
  console.error(`Usage: set-role <email> <${ROLES.join("|")}>`);
  process.exit(1);
}

await connectDb();
const result = await User.updateOne({ email: email.trim().toLowerCase() }, { role: role as Role });
console.log(result.matchedCount === 1 ? `✅ ${email} is now "${role}"` : `❌ No account found for ${email}`);
await mongoose.disconnect();
process.exit(result.matchedCount === 1 ? 0 : 1);
