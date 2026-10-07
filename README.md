# PixelArt: Flower page transition for Framer

A pixel-grid flower (cream cells, red/yellow/blue fringes, dotted halo) that
plays full screen as a page transition, then fades out to reveal the page.

| File | What it is |
| --- | --- |
| `FlowerTransition.tsx` | The Framer code component. Self-contained: imports only `react` and `framer`, with the baked animation inlined (~130 KB base64, ~100 KB gzipped). Also exports the link override and a few helpers. |
| `FlowerTransitionOverrides.tsx` | The `withFlowerTransition` code override for nav links. |
| `demo.html` + `demo/` | Standalone preview with replay/outro buttons, sliders for duration, fade, columns and colours, a scrubber, and an FPS readout. |
| `tools/bake.py` | Turns the reference frames into the per-cell data and injects it into `FlowerTransition.tsx`. |
| `data/` | The same baked data as files (`flower-frames.bin.gz` + `flower-frames.json`). |

## Framer setup

### 1. Add the code files

1. In Framer, open **Assets → Code → +** and create a new code file named
   **`FlowerTransition`**. Replace its contents with `FlowerTransition.tsx`.
2. Create a second code file named **`FlowerTransitionOverrides`** and paste
   in `FlowerTransitionOverrides.tsx`. It imports from
   `./FlowerTransition.tsx`, so keep the first file's name exactly.

### 2. Put the intro on your pages

Framer has no shared layout that wraps every page. Add the component to each
page that should play the intro:

- Drag **FlowerTransition** from Assets onto the page as a **direct child of
  the page's top-level frame**. Any size works (for example 100×100 in a
  corner) because at runtime it renders a `position: fixed` overlay over the
  whole viewport.
- Don't nest it inside a frame that has a transform, sticky positioning, or
  a scroll container. CSS `position: fixed` is relative to a transformed
  ancestor, so the overlay would not cover the screen.
- To avoid repeating the setup, copy the layer to every page with the same
  settings. If you already have a Navigation component on every page, you can
  instead put FlowerTransition inside that component, as long as nothing
  above it in the tree has a transform.

On the Framer canvas the component shows a still of the rest pose inside its
own box. It never covers the canvas.

Properties:

| Control | Default | Notes |
| --- | --- | --- |
| Direction | Intro | **Intro**: plays, then fades out to reveal the page. **Outro**: fades in over the page, plays, fires *On Complete*, and stays covering the page. |
| Auto Play | on | When off, the component waits for `triggerFlowerTransition()` (exported) or a `flowertransition:play` event on `window`. |
| Once / Session | off | Intro only. Plays on the first page view of the browser session (`sessionStorage`, wrapped in try/catch). |
| Duration | 1.8 s | Length of the flower animation. The ~6 s reference (rest, push-in, sweep, rest) is time-scaled to fit, not cut. |
| Fade | 0.5 s | The fade-out starts slightly before the animation ends so the two overlap. |
| Columns | 56 | Columns across the viewport in landscape. Cells stay square and their size follows the viewport width. The reference grid is ~56 columns wide. |
| Columns (Portrait) | 30 | Used when the viewport is taller than it is wide, so the flower isn't tiny on phones. |
| Background, Cream, Red, Yellow, Blue | `#08080C`, `#E8E8D8`, `#F80000`, `#F8C048`, `#1F3FFF` | Every shade in the animation (outlines, dark reds, tan blends) is a mix of these, so recolouring stays consistent. |
| On Complete | | Fires when the transition finishes. |

### 3. Play the outro on navigation links

1. Select a link layer: a nav item, button, or any frame with a **Link** set.
2. In the right panel, open **Code Overrides**, choose the file
   **FlowerTransitionOverrides**, and pick **withFlowerTransition**.
3. Do this for each link that should play the transition. In a Navigation
   component, set it once on the link layers inside the component.

On click the override:

1. Stops Framer's own link handling. It uses a capture-phase listener and
   leaves modified clicks (⌘/Ctrl/Shift), `target="_blank"`, other-origin
   links and same-page `#hash` links alone.
2. Fades the flower overlay in over the current page and plays the animation.
3. Navigates with Framer's router: `useRouter()` from `framer`, finding the
   route whose `path` matches the link and calling `navigate(routeId)`. If no
   route matches, or the router isn't available, it falls back to
   `location.assign()`.
4. Fades the overlay out to reveal the new page. The destination page's
   FlowerTransition intro notices this handoff and doesn't play a second
   time.

The override takes its duration, colours and columns from the
FlowerTransition component on the current page. If the page has none, it uses
the defaults.

The router has no official docs. This uses the `useRouter()` →
`{ navigate, routes }` shape the Framer community relies on. The hook is read
through `import * as Framer`, so a Framer version without it still works,
just with a full page load.

### 4. Preview

Overrides and the fixed overlay only run in **Preview** (▶ in the top bar)
and on the published site. The canvas only shows the still. Reload the preview
to replay the intro, and click an overridden link to see the outro. Turn
**Once / Session** on before publishing if you only want the intro on the
first visit.

### Reduced motion

If `prefers-reduced-motion: reduce` is set, nothing animates. The intro is a
quick 0.25 s fade of the plain background, and the outro fades in, navigates,
and fades out.

### Load and first paint

- The overlay is plain JSX with the background colour, so it is opaque from
  the very first (server-rendered) paint. The page renders underneath it
  straight away.
- The baked data is decoded once with the browser's `DecompressionStream`
  (a few ms) and cached for later navigations. Until then the overlay shows
  only the background colour. If decoding is unsupported (very old browsers),
  the transition falls back to a plain fade.

## Demo / tuning

Open `demo.html` directly in a browser. No server is needed.

- **Replay intro** / **Play outro** buttons. The outro also switches the fake
  page between "Home" and "About" to show the navigate-and-reveal step.
- Sliders for duration, fade, columns (landscape and portrait), and colour
  pickers.
- A **scrubber** that draws any moment of the baked animation, useful for
  comparing against the reference frames.

After changing `FlowerTransition.tsx`, rebuild the demo bundle:

```sh
npm install
npm run build:demo   # esbuild → demo/demo.js ("framer" is stubbed by demo/framer-stub.ts)
npm run typecheck
```

## Re-baking the animation

```sh
python3 tools/bake.py path/to/allframes [--preview out_dir]
```

This needs Python 3 with `numpy` and `Pillow`, and takes about 3 minutes. It
rewrites `data/` and the block between `// BAKED DATA START` and
`// BAKED DATA END` in `FlowerTransition.tsx`. `--preview` writes
side-by-side PNGs (reference | re-render of the baked cells). Rebuild the demo
afterwards.

How the bake works:

- **Grid.** The reference uses a fixed grid with an 18.72 px pitch at 1056 px
  wide, giving 57 × 30 cells (including the partial edge cells). Each frame's
  phase is measured from the luminance spectrum.
- **Cells.** Every cell in the reference is drawn as concentric squares: a
  full cream square, a smaller square with a thin dark or coloured outline, a
  hollow outlined square in the halo, and so on. For each cell the script
  measures nine 1 px rings from the edge to the centre and classifies each
  ring into a 15-colour palette. A ring counts as "ink" when at least 40% of
  it is non-background, so 1 px outlines survive. The rings are then
  collapsed into at most 4 runs of `(outer radius, colour)`. At runtime each
  run is one rectangle, drawn from the outside in.
- **Palette.** Palette entries are stored as weights of cream / yellow / red /
  blue over the background, which is why the colour controls recolour every
  blend.
- **Timeline.** A clean rest pose (reference frames 223–234, held 0.45 s), then
  the reference from frame 54 (its cut to the close-up) through the push-in
  and sweep back to the rest pose at frame 234. Near-duplicate frames are
  dropped, leaving the key frames listed in `data/flower-frames.json`. At
  runtime, key frames are interpolated by timestamp: run sizes are tweened
  when a cell keeps its structure, otherwise it switches at the midpoint.
- **Pinterest UI removed.**
  - Frames 1–53 (play icon, cursor, hover ring) are not used.
  - The "Save" pill (top-left, up to frame 75) is painted over with
    background.
  - The hand cursor (frames 54–66) is found by template matching, and the
    cells under it are filled from the nearest frame where they are
    uncovered.

## Rendering notes

- One `<canvas>`, sized to the viewport × `devicePixelRatio` (capped at 2).
  Rectangles are snapped to device pixels.
- Cells are batched by layer and colour (at most 4 × 15 `fill()` calls per
  frame), so a full screen of ~2,000 cells stays at 60 fps on laptops and
  phones.
- Viewports with a different aspect ratio than the reference are centred.
  Beyond the baked area, edge cells keep going and shrink over 4 cells, which
  continues the dotted fall-off instead of leaving a hard edge.
- `requestAnimationFrame` with wall-clock time, so the timing is independent
  of the display's refresh rate.
