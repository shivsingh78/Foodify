/** One structured JSON line per event. Callers pass ids and counts only, never order payloads or secrets. */
export const logEvent = (event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info"): void => {
  const line = JSON.stringify({ component: "orchestration", event, ...fields, at: new Date().toISOString() });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
};

/** Short failure text safe to persist: no connection strings, no stack, bounded length. */
export const sanitizeError = (error: unknown): string => {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
  return raw.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted-url]").slice(0, 200);
};
