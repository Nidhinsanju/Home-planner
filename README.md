# Vastu 3D Visualizer

Upload a floor plan, get an accurate 2D/3D model and a Vastu report, then fix it by chatting with an AI.

- **Build from an image.** A vision model reads the rooms, written sizes, doors and windows from a floor-plan image; the app builds the plan to the written sizes and finds the walls and open areas from the image's pixels.
- **Floorplanner-style editor.** Walls form a graph, rooms are labelled spaces, doors and windows sit on walls, furniture is free. 2D editor with inside dimensions, and a 3D view.
- **Vastu report.** A deterministic Vastu analysis (rules in code, not AI): zones, entrance, Brahmasthan, a score with reasons, one-click fixes and remedies.
- **AI that edits the plan.** Ask in plain words ("make the kitchen 12 by 10", "add a window to bedroom 1", "fix my Vastu"); the AI answers with commands that the app checks and applies, with undo.
- **Works with any AI model.** Bring your own key and model: OpenAI, Anthropic, Google Gemini, OpenRouter, any OpenAI-compatible provider, or a local model (Ollama, LM Studio).

## Quick start

Requirements: Node.js 20+, MongoDB (local or Atlas), an API key for an AI model that accepts images.

```bash
git clone <this repo>
cd vastu-3d-visualizer
npm install
cp .env.example .env     # then fill in .env (see below)
npm run dev              # http://localhost:3000
```

Fill in `.env` (all settings are explained in [.env.example](.env.example)):

| Setting | Required | What it is |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string |
| `SUPER_KEY` | yes | 32+ random characters that sign login tokens (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `AI_API_KEY` | yes* | your provider's key (*not needed for a local server) |
| `AI_MODEL` | yes | the model name exactly as your provider lists it; it should accept images |
| `AI_FALLBACK_MODELS` | no | models to try in order when `AI_MODEL` fails |
| `AI_VISION_MODEL` | no | a separate model for reading floor-plan images |
| `AI_PLANNER_MODEL` | no | a stronger model for big requests ("design a 3BHK") |
| `AI_BASE_URL` | no | any OpenAI-compatible address; worked out from the key for OpenAI, OpenRouter, Anthropic and Gemini |

The key and model are read **only** from `.env`. No model name is built into the code.

### Provider examples

```bash
# OpenAI
AI_API_KEY=sk-...            AI_MODEL=<an OpenAI vision model>
# Anthropic
AI_API_KEY=sk-ant-...        AI_MODEL=<a Claude model>
# Google Gemini (AI Studio)
AI_API_KEY=AIza...           AI_MODEL=<a Gemini Flash model>
# OpenRouter (hundreds of models with one key)
AI_API_KEY=sk-or-...         AI_MODEL=<provider/model>
# Ollama on your computer (free, no key)
AI_BASE_URL=http://localhost:11434/v1    AI_MODEL=<a vision model you pulled, e.g. a llama vision model>
```

## How the AI part is built to work with any model

- One client (`src/lib/aiClient.ts`) speaks the OpenAI-compatible Chat Completions API, which all of the above support.
- Prompts (`src/lib/aiPrompt.ts`) ask for **plain text or one JSON shape** with examples; no tool calling or provider-only features are required. Optional features (JSON schema output, a reasoning setting) are only sent where supported, and dropped automatically if a model refuses them.
- Every reply goes through one parser (`src/lib/modelReply.ts`): it strips "thinking" blocks and code fences, finds the JSON, keeps only known commands with sane values, and never throws. The front end always receives the same shapes, whatever the model wrote.
- Results are checked in code before they change anything: plans are validated and dry-run, "Fix with AI" changes are re-scored and rejected unless the Vastu score really improves without losing rooms.
- When a model fails (busy, out of credit, unusable answer), the next model in `AI_FALLBACK_MODELS` is tried.

## Security

Login (JWT + bcrypt), rate limits, and prompt-injection defences are described in [SECURITY.md](SECURITY.md).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (AI config, reply parsing, prompt-injection defences, rate limits, plan logic) |
| `npm run lint` | Lint `src` with oxlint |
| `npm run typecheck` | Type-check with `tsc` |

## Project layout

| Path | Contents |
| --- | --- |
| `src/plan/` | The building model, pure and tested: `types`, `geometry`, `ops` (immutable edits), `rooms` (room detection, inside sizes), `commands` (AI commands → plan edits), `extraction` / `fromExtraction` / `wallMask` (building from an image), `importPlan` (plan JSON import), `vastu` (Vastu analysis) |
| `src/lib/` | Server side: `aiClient` (config, model rotation), `aiPrompt` (all prompts), `modelReply` (reply parsing), `promptSafety` (injection defences), `rateLimit`, `aiChat`, `planImage`, `vastuFix`, `session`, `db` |
| `src/app/api/` | Routes: `chat`, `plan-image`, `vastu-fix` (routes, so the browser can cancel them) |
| `src/actions/` | Server actions: login/sign-up, saving plans, chat history |
| `src/editor/` | 2D editor, 3D view, sidebar, Vastu tab |
| `tests/` | Node test runner tests (`npm test`) |

Everything is in **feet**: `x` grows east (right), `y` grows south (down), north is up unless set otherwise on the Vastu tab. Room sizes are shown inside the walls, as on floor plans.
