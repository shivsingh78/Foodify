/** Operational error that is safe to show to the client. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(message: string, code?: string) {
    return new AppError(400, message, code);
  }
  static unauthorized(message = "Authentication required", code?: string) {
    return new AppError(401, message, code);
  }
  static forbidden(message = "You do not have permission to do this", code?: string) {
    return new AppError(403, message, code);
  }
  static notFound(message = "Resource not found", code?: string) {
    return new AppError(404, message, code);
  }
  static conflict(message: string, code?: string) {
    return new AppError(409, message, code);
  }
  static tooMany(message = "Too many requests, please try again later", code?: string) {
    return new AppError(429, message, code);
  }
}
