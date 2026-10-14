# Foodify — Refactor Audit

State of the repository **before** this refactor, and what was done about each finding.
"Fixed" means implemented; nearly all backend fixes have automated tests (`backend/tests`). Not covered by tests: the upload-hardening changes and Cloudinary cleanup (need real credentials), and the frontend.

## Critical

| # | Finding | Status |
|---|---------|--------|
| C1 | `google-signin` trusted a client-sent email (account takeover by knowing any email). `google-signup` was mid-migration. | Fixed: both verify a Firebase ID token server-side; identity comes from token claims; UID is linked and re-checked. |
| C2 | Item edit/delete had no ownership check; any logged-in user could change/delete any item. | Fixed: owner role + item must belong to caller's shop. |
| C3 | `update-status` had no authorization or transition rules; any user could set any status on any order. | Fixed: owner-of-that-shop only, state machine enforced, compare-and-set on current status. |
| C4 | Client supplied prices and `totalAmount`; Razorpay amount came from the client. | Fixed: totals computed from DB prices; unknown fields rejected. |
| C5 | Payment "verification" only fetched a payment id and never checked signature, order binding or amount; any customer could mark any order paid. | Fixed: HMAC signature, order/payment binding, amount match, captured status, atomic one-time flip. |
| C6 | `get-order-by-id`, delivery OTP send/verify had no authorization; `populate` leaked full user documents (password hashes). | Fixed: viewer-scoped access; password/OTP fields are `select:false` and stripped by `toJSON`. |
| C7 | Socket `identity`/`updateLocation` trusted a client `userId`; locations were broadcast to every client. | Fixed: handshake auth from the session cookie, per-user rooms, location only to the customer of the active delivery. |
| C8 | Password-reset token / OTP: OTP stored in plaintext, no attempt limit, reset token reusable until expiry, session middleware accepted reset tokens. | Fixed: hashed OTP, 5-attempt limit, single-use jti-bound token, session middleware rejects purpose tokens. |
| C9 | Mail module read `EMAIL`/`PASS` while `.env` defines `EMAIL_USER`/`EMAIL_PASSWORD`, so OTP emails could never send. | Fixed, later replaced: mail now goes through Resend (`RESEND_API_KEY`, `EMAIL_FROM`). |
| C10 | OTP generated as 6 digits but validated as 4 digits (reset flow impossible); frontend never sent `resetToken`. | Fixed in schema, backend and frontend. |

## High

- `isAuth` role was not loaded; delivery/owner/customer endpoints had no role checks → `requireRole`.
- State-changing `GET` routes (`/item/delete`, `/order/accept-order`) were CSRF-able → `DELETE`/`POST`, plus an `Origin` check on all unsafe methods.
- Delivery assignment acceptance raced (two partners could both accept) → compare-and-set + partial unique index.
- Ratings could be spammed and unrelated to purchases → one rating per user/item, delivered orders only.
- Signup returned `{message, userResponse}` while the frontend stored the whole body as the user; `SignUp.jsx` called `setState` during render. Fixed.
- `createEditShop` returned a wrapper object the frontend stored as the shop; `getMyShop` returned `null` from a handler (request hung). Fixed.
- Uploads used the client filename in `./public` (collisions/traversal), no type/size limit → random temp names, image types only, 5 MB.
- `JWT_SECRET` not validated; DB failure at boot only logged → validated env, fail-fast.
- Regex built from user input (ReDoS/injection) → escaped.
- Cancel path and `cancelled` status did not exist → added to the state machine.

## Medium / low

- No unavailable flag (`isAvailable`) → added (default true, so existing documents keep working).
- No pagination/filters on search → added with validated queries and indexes.
- Missing indexes on order/assignment lookups → added.
- Cloudinary images were never deleted on replace/delete → best-effort cleanup.
- Frontend: 87 hard-coded brand colours → design tokens; oversized single 1.15 MB bundle → split; 6 lint errors fixed.
- Nested `pnpm-workspace.yaml` files in `backend/` and `frontend/` broke `pnpm` commands run inside those folders → removed (root file already covers them).
- Stale `package-lock.json` files (project uses pnpm) are still tracked; delete them when convenient.

## Not fixed / needs your action

- **`.env` files were committed in earlier history** (`git log --all -- backend/.env`). Treat every key that was in them as exposed and **rotate** (MongoDB, JWT, Gmail app password, Firebase service account, Razorpay, Cloudinary).
- Refunds for cancelled prepaid orders are not automated (no refund flow existed; owner cancellation is allowed and flagged to the customer only through a notification).
- JWT sessions are stateless: a password reset does not invalidate existing sessions.
- Owners and delivery partners can no longer self-select a role at signup. Promote accounts with `pnpm --filter backend set-role <email> <owner|deliveryBoy>`. An approval/admin UI is a good next feature.
- Frontend has no automated tests; the UI redesign was verified by build + lint only, not by screenshots or end-to-end browser runs.
