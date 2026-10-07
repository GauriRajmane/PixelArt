# PixelArt

Turn any image into a moving pixel animation. Upload a picture, and PixelArt
cuts out the subject and turns it into a 3D point cloud. A camera then flies
around it (rest → turn and push in → close-up → wide tilted sweep → settle)
and every frame is drawn as a fine grid of square dots. It ends with the
signature finish: the colour floods out from the subject while it's still
moving, then the background grows back in through it, square by square.

Styles:

- **X-ray** (default): a translucent, glowing look. Dots are tinted (cyan by
  default) and edges and fine detail light up. Where parts of the subject
  overlap as it turns, the brightness adds up, like an X-ray.
- **Classic**: the look of the original reference. Cream dots, red / yellow /
  blue fringes where the image is changing, and hollow outlined dots in the
  dim halo.
- **Photo**: dots take the image's own colours.

## Use it

Open **`index.html`** in a browser. No server or install is needed: the built
app is checked in at `dist/app.js`.

1. **Add an image.** Upload it, drop it anywhere on the page, or paste it from
   the clipboard. *Example* loads a built-in flower. The best images have one
   subject on a fairly plain or gradient background.
2. **Check the cut-out.** The thumbnail shows the detected subject in cyan,
   with the background dimmed. Drag **Cut-out** if too much or too little is
   kept. Turn **Remove background** off to animate the whole image, or turn
   **Invert subject** on for a dark subject on a light background that gets
   picked up backwards.
3. **Tune the look.** Style, tint, background, **Density** (dot columns
   across the frame: higher means smaller, finer dots), **Dot size** and
   **Glow**.
4. **Tune the motion.** **Duration** (seconds of camera motion), **Movement**
   (0 = still, 1 = default path, 1.5 = more dramatic) and **Depth** (how much
   the subject bulges in 3D as it turns).
5. **Ending.** **Fill colour** floods the frame from the subject. It starts
   during the last stretch of motion, so nothing stops abruptly. **Reveals**
   is what grows back in through it: a colour, or *Transparent* so the
   embedding page shows through. **Fill** and **Reveal** set the timing.
6. **Export** (choose the aspect ratio and size first):
   - **Video**: records the full animation in real time to WebM (or MP4 in
     browsers that only record MP4). Video has no transparency, so a
     transparent reveal shows the background colour.
   - **PNG frame**: the current frame at full size.
   - **Embed .html** / **Copy embed**: a single self-contained HTML file
     (player plus image, about 100 KB) that plays the animation and fills its
     container. To use it in Framer, add an **Embed** layer, choose *HTML*, and
     paste the copied code. Or host the file and embed it by URL. It loops if
     *Loop* is on when you export.

Settings are remembered in your browser between visits.

## How it works

`src/engine.ts` (no dependencies; used by the app and by every export):

1. **Analysis** (when the image or cut-out settings change). The image is
   scaled to at most 460 px.
   - **Background:** modelled as a smooth gradient, using colour profiles from
     bands just inside each edge (so thin frames are skipped). The profiles
     are median-smoothed so a subject touching an edge doesn't leak in, then
     blended across the image.
   - **Subject mask:** a soft threshold on the distance from that gradient.
   - **Edges:** Sobel on the masked brightness.
   - **Depth:** the distance from the subject's edge (chamfer transform), so
     the middle of the subject bulges towards the camera.
   - **Points:** every subject pixel becomes a 3D point with an X-ray
     intensity (body + brightness + edges), a solid intensity and its colour.
2. **Camera path.** Smooth Catmull-Rom curves through key poses (yaw, pitch,
   roll, zoom, pan, horizontal stretch), scaled by *Movement*.
3. **Projection.**
   - Each frame, the points are rotated, given perspective, and spread
     across neighbouring grid cells.
   - Each point counts as much as the screen area it covers, so brightness
     stays the same as the camera zooms. When zoomed past the image's own
     detail, a point spreads over a box the size of its footprint, so there
     are no gaps.
   - A light blur and an exposure curve turn the totals into a 0–1
     brightness per cell.
4. **Dots.** The grid pitch is snapped to whole device pixels so every cell is
   identical (no beat patterns). Dot size and colour come from the cell
   brightness and the chosen style. Rectangles are batched by colour, so a
   frame is a few dozen `fill()` calls.
5. **Ending.**
   - Fill timing comes from the frame where the fill starts: cells inside the
     subject start first, then the fill moves outward by distance with a
     little jitter.
   - **Fill:** cells grow into solid squares of the fill colour.
   - **Reveal:** the same cells, in the same order, are punched back out
     (`destination-out`), leaving the canvas transparent.

`src/player.ts` is the small standalone player built into the embeds.
`src/app.tsx` is the creator UI (React).

At the default density, a 1440×900 browser window plays at 60 fps, at 1× and
2× pixel density, in Chromium.

## Develop

```sh
npm install
npm run build       # player → src/generated/player-bundle.ts, app → dist/app.js
npm run dev         # rebuild the app on change
npm run typecheck
```

`build.mjs` builds the player first and inlines it as a string, which is how
exported HTML files carry their own player.

## Legacy

The earlier version of this project, a Framer page-transition component with
the animation baked from a reference video, is kept in
[`legacy/page-transition/`](legacy/page-transition/) with its own README.
Rebuild its demo with `npm run legacy:build-demo`.
