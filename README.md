# PixelArt

Upload a photo of a flower and get back a **blooming pixel animation**: the
flower starts as a closed bud on its stem and unfurls into the flower in your
photo, petal by petal, while the camera turns gently around it. Every frame is
drawn as a fine grid of square dots. It ends with the signature finish: the
colour floods out from the flower while it's still moving, then the background
grows back in through it, square by square.

There is also a **Fly-through** mode, where the camera flies around the still
subject instead (rest → turn and push in → close-up → wide tilted sweep →
settle), for images that aren't flowers.

Styles:

- **X-ray** (default): a translucent, glowing look. Dots are tinted (cyan by
  default) and petal edges and veins light up. Where parts of the subject
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
4. **Tune the motion.**
   - **Bloom** (default) or **Fly-through**.
   - **Bud:** how closed the flower starts (1 = a tight bud, 0 = no bloom).
   - **Centre:** where the flower blooms from. It's detected automatically
     (the densest part of the subject). The thumbnail shows it as a cross,
     with a dashed ring for the head size. Click the thumbnail to move it, for
     example onto a different flower in a bunch. *Reset* goes back to auto.
   - **Duration:** seconds of motion. The bloom completes at about 80%.
   - **Camera:** how much the camera turns (0 = still, up to 1.5).
   - **Depth:** how much the subject bulges in 3D.
6. **Ending.** **Fill colour** floods the frame from the subject. It starts
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
   scaled to at most 640 px.
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
2. **Bloom** (synthesised from one photo of an open flower, by running the
   bloom backwards):
   - **Head:** the bloom centre is the point of highest subject density at a
     coarse scale, so thin stems and leaves barely register. Its extent is
     measured from the points that point sideways or upward, so the stem
     doesn't inflate it and long stamens are included. Everything inside the
     head blooms. The stem (a thin, near-vertical column under the centre)
     and anything outside the head stay put. Half-folded points smear into
     arcs and stripes, so a point is either fully part of the head or not.
   - **Closed bud:** each point's direction from the centre is swung onto a
     narrow cone around an "up and slightly towards the camera" bud axis,
     with a spiral twist that grows towards the petal tips. The petals are
     hinged at the centre and wrap into an upright, twisted bud that sits on
     the stem.
   - **Opening:** each frame interpolates every point between its bud
     direction and its real position (slerp). The outer petals open first
     and the centre last. Each petal (angular sector) gets its own timing
     offset and a small flutter, and the head grows and rises into place.
   - **Camera:** a gentle turn and slight pull-back while it blooms, framed
     as a close-up on the head.
3. **Fly-through camera.** Smooth Catmull-Rom curves through key poses (yaw,
   pitch, roll, zoom, pan, horizontal stretch), scaled by *Camera*.
4. **Projection.**
   - Each frame, the points are rotated, given perspective, and spread
     across neighbouring grid cells.
   - Each point counts as much as the screen area it covers, so brightness
     stays the same as the camera zooms. When zoomed past the image's own
     detail, a point spreads over a box the size of its footprint, so there
     are no gaps.
   - Each dot shows the *average* intensity of the surface landing in it,
     with a gentle boost where layers overlap (X-ray translucency). That way
     a tightly packed bud doesn't blow out and zooming doesn't change
     brightness.
   - Exposure is calibrated once per animation on the open flower, so a
     textured peony and a sparse lily both read well.
   - When points are packed much more tightly than the dots, only an
     even-grid quarter of them is projected, each counting four times (level
     of detail).
5. **Dots.** The grid pitch is snapped to whole device pixels so every cell is
   identical (no beat patterns). Dot size and colour come from the cell
   brightness and the chosen style. Rectangles are batched by colour, so a
   frame is a few dozen `fill()` calls.
6. **Ending.**
   - Fill timing comes from the frame where the fill starts: cells inside the
     subject start first, then the fill moves outward by distance with a
     little jitter.
   - **Fill:** cells grow into solid squares of the fill colour.
   - **Reveal:** the same cells, in the same order, are punched back out
     (`destination-out`), leaving the canvas transparent.

`src/player.ts` is the small standalone player built into the embeds.
`src/app.tsx` is the creator UI (React).

At the default density (300 columns), a 1440×900 browser window plays at
60 fps, at 1× and 2× pixel density, in Chromium. That includes a dense peony
photo with about 170k points.

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
