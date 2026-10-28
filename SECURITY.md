# Security

## Secrets

- All secrets live in `.env`, which is git-ignored. `.env.example` lists every setting without values.
- The AI key and model names are read only from `.env` on the server. They never reach the browser, and errors shown to users never include the key or the provider's raw error.
- System prompts are defined on the server (`src/lib/aiPrompt.ts`). The browser cannot send or change a system prompt, so nobody can turn your AI key into a general-purpose chatbot through the API.

## Authentication

- Accounts: email + password. Passwords are hashed with bcrypt (cost 12) and never sent to the browser.
- Sign-up checks the email format, stores it lower-case, requires 8–128 character passwords, and cleans the name.
- Login gives the same answer, after the same amount of work, for an unknown email and a wrong password, so it doesn't reveal who has an account.
- Brute-force protection: at most 5 login attempts per email and 30 per network address per 15 minutes; 5 sign-ups per network address per hour.
- Sessions are JWTs signed with `SUPER_KEY` (HS256 only, fixed issuer, 7 days). There is no fallback secret, and a key shorter than 32 characters is refused.
- Every server action and API route checks the token, and users can only read and change their own plans.

The token is kept in the browser's `localStorage` and sent as a `Bearer` header. A further hardening step would be an `httpOnly` cookie, which scripts can't read.

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
