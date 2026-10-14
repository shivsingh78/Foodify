import type { UserRole } from "../models/user.model.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `isAuth`. */
      userId?: string;
      userRole?: UserRole;
      /** Set by `validate` for query strings (Express 5 makes `req.query` read-only). */
      validatedQuery?: unknown;
    }
  }
}

export {};
