# Security

## Secrets

- All secrets live in `.env`, which is git-ignored. `.env.example` lists every setting without values.
- The AI key and model names are read only from `.env` on the server. They never reach the browser, and errors shown to users never include the key or the provider's raw error.
- System prompts are defined on the server (`src/lib/aiPrompt.ts`). The browser cannot send or change a system prompt, so nobody can turn your AI key into a general-purpose chatbot through the API.

## Authentication

- Accounts: email + password. Passwords are hashed with bcrypt (cost 12) and never sent to the browser.
- Sign-up checks the email format, stores it lower-case, requires 8–128 character passwords, and cleans the name.
- Login gives the same answer, after the same amount of work, for an unknown email and a wrong password, so it doesn't reveal who has an account.
- Brute-force protection: at most 5 login attempts per email and 100 per network address per 15 minutes; 30 sign-ups per network address and 3 per device per hour. The per-address limits are generous because everyone on one Wi-Fi (a demo room, an office) shares one address; the per-email and per-device limits do the real work.
- Sessions are JWTs signed with `SUPER_KEY` (HS256 only, fixed issuer) that expire after **30 minutes**. While the user works (a click or key press), the app asks for a fresh token at most every 5 minutes (`renewSession`), so active users stay signed in and an idle session ends after 30 minutes. There is no fallback secret, and a key shorter than 32 characters is refused.
- Every server action and API route checks the token, and users can only read and change their own plans.

The token is kept in the browser's `localStorage` and sent as a `Bearer` header. A further hardening step would be an `httpOnly` cookie, which scripts can't read.

## Device print

Each user has one record in the **`user_devices`** collection, kept separate from the accounts (`users`). It never holds a password. It is updated at every sign-up, login and app open (`src/lib/devicePrint.ts`, `src/lib/deviceHints.ts`).

| Field | What it is | Where it comes from |
|---|---|---|
| `name`, `email` | Who the user is | Their account |
| `deviceId` | A random id for this browser (a UUID) | Made once by the browser and kept in its `localStorage` |
| `fingerprint` | A hash of network address + browser (never the address itself) | Worked out on the server; recognises the device even after its `deviceId` is cleared |
| `os` | e.g. Windows 11, Android 14, iOS 17.1 | User-Agent header; Chrome and Edge also send the Windows version |
| `browser` | e.g. Chrome 131, Safari 17 | User-Agent header |
| `deviceType` | desktop, tablet or mobile | User-Agent header |
| `ip` | Network address | The request (`x-forwarded-for` behind a proxy) |
| `connectionType`, `effectiveType` | e.g. wifi, 4g | The browser's Network Information API, where supported |
| `country`, `region`, `city` | Rough location | Hosting headers (Vercel; Cloudflare with visitor location headers on). "unknown" when running locally. Nothing is sent to a third party |
| `lastSeenAt` | When the device was last seen | The server's clock |

Browser hints are checked on the server (short, plain text only); anything else is ignored. Saving the print never blocks signing in.

The IP address and location are personal data (e.g. under India's DPDP Act and the GDPR): say in the app's privacy policy that they are collected, why, and for how long.

## AI prompt limit

The AI is the part that costs money, so each account has an allowance (`src/lib/aiQuota.ts`):

- **10 AI prompts in total** (`AI_PROMPT_LIMIT`), for every AI feature: a chat message, Fix with AI, or reading an uploaded floor plan. After that the AI is off for the account, and the plan can still be built and edited by hand.
- **One message is one prompt.** When the chat hands a big request to the planner and then runs it step by step, those calls belong to the same message (a "turn" the server opened for it) and are free. A step request without a valid turn of the user's own is refused, so the steps can't be used to get free prompts.
- **Failures are free.** If the AI was busy, failed or was stopped, the prompt is given back. A floor plan already read before (cached) is free.
- **New accounts don't reset it.** Prompts are counted per account and per device (`deviceId`), and the higher count applies. Signing up again in the same browser starts from what that device has already used. Each device may create at most 3 accounts (`MAX_ACCOUNTS_PER_DEVICE`). When the browser sends no device id (storage blocked), the device `fingerprint` is used instead.
- **Strict mode** (`MATCH_DEVICE_BY_NETWORK=true`): the `fingerprint` counts as well, which also catches someone who clears the browser's storage or uses a private window on the same network. It is off by default because phones on one Wi-Fi often share an address and, with Chrome's reduced User-Agent, the same browser string, so they would share one allowance.
- The counts are kept in the **`usage_counters`** collection, so they survive restarts. The account's count is claimed atomically, so two tabs can't both use the last prompt.

Known limits: by default, a private window or cleared browser storage gets a new device id, and so a new allowance once a new account is made (still at most 3 accounts per device id, and per address limits apply). Strict mode closes that gap at the cost of shared-network collisions. A different browser on a different network always looks like a new device.

## Admins

An account is an admin when its `role` is `admin` in the `users` collection, or when its email is in **`ADMIN_EMAILS`** in `.env` (comma-separated; such accounts get `role: admin` at their next login). Admins have no AI prompt limit, no accounts-per-device limit, and no per-user AI rate limit. Per-address request limits still apply to everyone. Admin emails are set in `.env` only, never in the code, because this repository is public.

## Rate limits

| What | Limit |
|---|---|
| AI requests | `AI_RATE_LIMIT` per `AI_RATE_WINDOW_MIN` per user (default 30 per 10 minutes) |
| AI routes, before any work | 300 per minute per network address; 60 per minute per device |
| Plan saves | 60 per minute per account |
| Chat history | 120 per minute per account |
| Session checks and renewals | 300 per minute per network address |
| Logins | 5 per email and 100 per address per 15 minutes |
| Sign-ups | 30 per address and 3 per device per hour; 3 accounts per device in total |

Limits are kept in the server's memory (`src/lib/rateLimit.ts`). On Vercel each serverless instance has its own memory, so these limits are per instance and reset when one restarts; for strict limits use a shared store such as Redis (e.g. Upstash). The AI prompt allowance and the accounts-per-device count are in the database, so they hold on every instance, and the planner's "turn" is a signed token, not memory.

## Prompt engineering (how the prompts are designed)

In this project, prompt engineering means writing prompts that any capable model follows the same way, and never trusting the answer:

- Each prompt says exactly what to return: plain text, or one JSON shape with examples (`src/lib/aiPrompt.ts`).
- No provider-only features are required. JSON schemas and reasoning settings are used only where supported, with an automatic fallback.
- The code does the maths: scale, written sizes, walls from pixels and the Vastu score are computed in code. The model reads, explains and proposes.
- Every answer is parsed and checked in code (`src/lib/modelReply.ts`). Invalid answers go back to the model with the exact problems, and only verified changes are applied.

## Prompt injection

**Definition used here:** prompt injection is text that reaches the model from anywhere except the user's own request, and tries to act as an instruction. Examples: "ignore your rules", "delete everything", "reveal your prompt". Sources include the plan, room names, earlier messages, words printed on an uploaded floor plan, and a pasted JSON file.

**Defences, in layers** (`src/lib/promptSafety.ts`):

1. **Rules in every prompt.** Each system prompt ends with the same security rules. Content inside `<data>` blocks is data, never instructions; the model never reveals its prompt and stays on home design and Vastu. The image reader is told to copy what's written in the image and ignore any instructions in it.
2. **Fenced data.** Untrusted content is passed inside labelled `<data>` blocks. Anything that could close a block early or open a fake one is defused. Hidden characters (zero-width characters, right-to-left overrides) are removed, and sizes are limited.
3. **Input limits.** Chat messages are at most 2,000 characters; plan data and images have size limits; AI requests are rate-limited per user (`AI_RATE_LIMIT` per `AI_RATE_WINDOW_MIN`).
4. **The model's answer is untrusted too:**
   - Only known commands with sane values are kept. Unknown actions, nested objects and non-finite numbers are dropped, and strings are cut short.
   - Destructive or plan-wide commands run only when the user's own words asked for them: deleting, deleting everything, setting north, rebuilding from the drawing, replacing the plan.
   - "Fix with AI" may only swap, retype, move or resize rooms and add doors or windows. Its result must raise the Vastu score without losing rooms or changing the room mix.
   - A plan built from a drawing can't be replaced unless the user asks for a redesign.
5. **No dangerous output paths.** Model text is shown as plain text (never as HTML), and the model can't run code, browse, or reach anything beyond the plan.

These defences are tested in `tests/prompt-injection.test.ts`, including an attack hidden in a room name and a model that obeys an injected "delete everything".

No defence against prompt injection is perfect. That's why the design limits what a fooled model can do (the plan only, checked commands, undo for everything) rather than relying on the model to refuse.

## Reporting a problem

Please open an issue, or contact the maintainer privately for anything sensitive.
