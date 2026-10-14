/** Mailbox providers whose domains nobody but the provider can verify, so Resend can never send from them. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com",
]);

/** Returns the sender's domain (lower-case) from "a@b.com" or "Name <a@b.com>". */
export const senderDomain = (from: string): string | undefined =>
  /@([^\s<>@]+?)>?$/.exec(from.trim())?.[1]?.toLowerCase();

export const isFreeMailSender = (from: string): boolean => {
  const domain = senderDomain(from);
  return domain !== undefined && FREE_MAIL_DOMAINS.has(domain);
};
