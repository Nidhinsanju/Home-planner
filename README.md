# Vastu 3D Visualizer

A home planner modelled on Floorplanner's way of building plans, made simpler, plus Vastu-aware room types and an AI assistant. You draw in a 2D plan editor and view the result in 3D.

## Setup

1. Install dependencies: `npm install`
2. Create a `.env` file:

   ```
   MONGODB_URI=mongodb://127.0.0.1:27017/vastu-3d-visualizer
   HF_TOKEN=<Hugging Face access token, used for the AI assistant>
   SUPER_KEY=<long random string used to sign login tokens>
   ```

   `SUPER_KEY` is required. Generate one with
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
3. Start MongoDB, then run `npm run dev` and open http://localhost:3000.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | Lint `src` with oxlint |
| `npm run typecheck` | Type-check with `tsc` |

## The building model (`src/plan/`)

The model follows Floorplanner:

- **Walls form a graph.** Corners are shared, so dragging a corner or a wall stretches every wall attached to it. Drawing a wall that touches or crosses existing walls splits them at that point and connects to them (`ops.addWall`).
- **Rooms are marked, not automatic.** Walls that enclose an area make a plain *space* (`detectSpaces`). The space becomes a room only when it carries a room *label* (name and Vastu room type). Labels are added by Draw Room, Quick Room, the AI, or "Make this a room" on a selected space (`detectRooms` = labelled spaces). `ops.reconcileLabels` keeps labels attached when walls change. A wall that splits a room makes both halves rooms; merging rooms keeps one label. "Keep walls, remove room" (`ops.unmarkRoom`) turns a room back into a space.
- **Doors and windows sit on a wall** at a fraction `t` along it, so they move with the wall.
- **Furniture** items are free objects with a position and rotation.
- **Units.** Everything is in **feet**. `x` grows east and `y` grows south, so north is `-y`. Metres are a display-only unit.

| File | Contents |
| --- | --- |
| `types.ts` | Plan types, room types, furniture catalog, defaults |
| `geometry.ts` | Vector and polygon maths |
| `ops.ts` | Pure, immutable edits: add/split/move walls, openings, items, rooms |
| `rooms.ts` | Room detection (faces of the wall graph) |
| `commands.ts` | AI JSON commands → plan operations, and the plan summary sent to the AI |
| `migrate.ts` | Converts old saves (rectangle rooms and loose walls) to the new model; the Example house |

## UI (`src/editor/`, `src/App.tsx`)

- `Editor2D.tsx` is the SVG plan editor:
  - Draw Room (R) and Draw Wall (W). While drawing a wall you can type a length and press Enter.
  - Doors, windows and furniture.
  - Drag corners, walls, doors and furniture.
  - Snapping and guides; hold Alt to disable snapping.
  - Zoom and pan; dimension labels.
- `View3D.tsx` renders the same plan in 3D: walls with real door and window holes, room floors, and furniture. It has a cutaway mode with low walls.
- `Sidebar.tsx` holds the tools, the furniture catalog, a room list and plot size, Quick Room (add a room of exact size next to the existing ones), and an inspector for the selected room, wall, corner, door/window or item.
- `App.tsx` manages plans P1 and P2 (editable, each with undo/redo) and the read-only Example. It saves with Ctrl+S and shows unsaved changes.

Saved plans are stored as `{ plan }` in the `Build` collection. Older saves are migrated when loaded.

## AI assistant

The chat POSTs the prompt and `describePlan(plan)` (rooms with bounds, walls, openings and items, all in feet) to `/api/chat` (`src/app/api/chat/route.ts`, which calls `runChat` in `src/lib/aiChat.ts`). It is a route rather than a server action so the **Stop** button can abort it: the browser cancels the fetch, the route's `request.signal` cancels the AI call, and a stopped turn is not saved to the chat history. The model replies with text and/or JSON commands: `build`, `delete`, `deleteAll`, `move` and `update`, given as one object, an array, or `{"commands": [...]}`. All commands from one reply are applied as one undo step, and the plan is saved.
