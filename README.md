# Two-Point Line Drawing Interactive

**Live Site Link:** https://content-interactives.github.io/two_point_drawing/

A React Cartesian-plane activity: users place **two integer lattice points per line**. Each pair defines a straight line through the segment, **extended to the SVG viewport** with **arrowheads on both clipped ends**. Up to **two** completed lines are shown at once; additional lines remain in **undo/redo history** but older graphics roll off the visible window. There is **no region shading** (contrast `shade_graph` / `multi_shade_graph`). Completing a segment triggers a **midpoint-out** grow animation before the line is appended to history.

## Tech stack

| Layer | Choice |
|--------|--------|
| UI | React 19 |
| Build | Vite 7 with `@vitejs/plugin-react` |
| Styling | `App.css` (segmented Undo / Redo / Reset “glow” styles); root layout inline in the component |
| Deploy | `gh-pages` publishing `dist/` |

Production builds assume hosting under **`/two_point_drawing/`** (`vite.config.js` → `base`), matching the live link above.

## Repository layout

```
src/
  main.jsx
  App.jsx              # Imports App.css, renders TwoPointDrawing
  App.css              # Segmented control styles (.segmented-glow-button.compact, …)
  index.css
  components/
    TwoPointDrawing.jsx
```

## Coordinate system

- **Logical domain**: \([-10, 10]\) on both axes; clicks snap to **integers** via `roundToTick` after `clamp`.
- **Canvas**: `500×500` SVG pixels; **`PADDING = 40`** defines the inner plot.
- **Mapping**: `valueToX` / `valueToY` (y inverted for SVG); `xToValue` / `yToValue` for pointer feedback.
- **Grid**: Pattern id `grid-two-point`, **`GRID_CELL = scaleX`** (one model unit per cell).

Axes extend with **`EXTENDED_MIN` / `EXTENDED_MAX`** (one unit past the labeled range) so gray axis arrowheads sit beyond the outer ticks. Tick labels use a unicode minus for negative values.

## Interaction flow

1. **Click** adds one snapped point. First click starts a segment; second click fixes the other endpoint and sets **`points.length === 2`**.
2. While **`points.length === 2`**, further clicks are ignored until the animation finishes and **`points`** clears.
3. **`hoverPreview`** tracks the lattice cell under the cursor (semi-transparent marker) whenever the mouse is over the plane.
4. **`useEffect`** on **`points.length === 2`** runs **`lineProgress`** from 0 → 1 over **`LINE_ANIMATION_DURATION_MS`** (1500 ms) with `requestAnimationFrame`. The drawn stroke is the segment between **midpoint** and both **clipped line endpoints**, scaled by **`lineProgress`**, with triangular arrows at the moving ends.
5. At **`lineProgress === 1`**, **`{ p1, p2 }`** is pushed onto **`history`** at **`historyIndexRef`**, **`historyIndex`** increments, **`points`** and **`lineProgress`** reset.

**Commit rule**: `setHistory((prev) => [...prev.slice(0, idx), { p1, p2 }])` — redo tail is truncated; there is **no** maximum length cap in code, so long sessions grow `history` until reset.

## Display window (`MAX_LINES = 2`)

- **`completedLines`**: `history.slice(0, historyIndex).slice(-MAX_LINES)` normally; while **`points.length === 2`** (animating the *next* line), **`slice(-(MAX_LINES - 1))`** so only **one** prior full line shows—avoiding three overlapping lines during the animation.
- **Points rendered**: `allPoints` merges endpoints of **`completedLines`** plus in-progress **`points`**, so endpoint markers match what is on screen.

## Line geometry (completed strokes)

For each segment, value-space endpoints map to SVG, then **`clipLineToRect`** against the full **`WIDTH × HEIGHT`** rectangle. **`orderEndpointsByPoints`** orders the clip so the infinite line direction matches **first click → second click**. **`arrowPoints`** builds two triangles; **`LINE_ARROW_SIZE`** is 10 px (axis corner arrows use separate **`arrowSize` / `arrowHeight`**).

Same helper pattern as `shade_graph` / `multi_shade_graph` (clip + arrows), without half-plane fills.

## History: undo / redo / reset

- **Undo**: `historyIndex = max(0, index - 1)`. Does **not** reparent partial strokes: if a line is mid-animation, undo is still only index-based (see code paths—typically users undo after commit for lines).
- **Redo**: `historyIndex = min(history.length, index + 1)`.
- **Reset**: `history = []`, `historyIndex = 0`, clear **`points`** and **`lineProgress`**.

Toolbar buttons call **`stopPropagation()`** so they do not add points. **`showGlow`** toggles the rotating orbit on the control cluster (`hide-orbit` when disabled after use).

## Accessibility and input

Wrapper: **`role="button"`**, **`tabIndex={0}`**, **`cursor: crosshair`**. SVG uses **`pointerEvents: 'none'`**; the outer **`div`** receives clicks. No keyboard drawing path.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Output to `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run deploy` | Build then `gh-pages -d dist` |

## Tunables

Top of `src/components/TwoPointDrawing.jsx`:

- `MIN` / `MAX`, `WIDTH` / `HEIGHT` / `PADDING`
- `MAX_LINES` (2)
- `LINE_ANIMATION_DURATION_MS`, `LINE_ARROW_SIZE`, `POINT_RADIUS`

## Comparison

| Interactive | Lines | Shading | Visible cap |
|-------------|-------|---------|-------------|
| **two_point_drawing** | Unlimited in history | — | 2 full + animating |
| **shade_graph** | 1 | Half-plane | 1 |
| **multi_shade_graph** | 2 | Four regions | 2 |
