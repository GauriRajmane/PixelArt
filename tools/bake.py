#!/usr/bin/env python3
"""
Bake the reference flower animation into compact per-cell data.

Usage:
    python3 tools/bake.py <frames_dir> [--preview <out_dir>]

<frames_dir> must contain manifest.json plus frame_XXXX.png (the first clean
cycle of the reference, 1056x540). Writes:

    data/flower-frames.bin.gz   gzipped binary (see "Binary format" below)
    data/flower-frames.json     metadata (grid, palette, frame times)
    FlowerTransition.tsx        the inline data block between the
                                BAKED DATA markers is replaced in place

Only numpy and Pillow are needed.

How the reference is decoded
----------------------------
The reference renders a fixed grid (pitch 18.72px at 1056px wide) where every
cell is drawn as a few *concentric squares*: e.g. a cream square with a thin
red outline, a red outline around a dark hole with a tiny grey outline inside
(the dotted halo), or a full-pitch cream square that merges with neighbours.

For every cell we measure the colour of each 1px Chebyshev "ring" around the
cell centre (9 rings from the edge to the middle), classify it into a small
palette, and collapse it into up to 4 runs (outer radius, palette index).
At runtime each run is one fillRect, drawn outside -> in.

The palette is stored as weights of the base colours (cream, yellow, red,
blue) over the background, so the colours stay themeable from props.

Pinterest UI in the recording is removed:
  * the opening rest pose is taken from clean frames 223-234 (frames 1-53
    carry the play icon / Save pill / cursor), and the main motion starts at
    frame 54 where the reference cuts from the rest pose to the close-up;
  * the "Save" pill (top-left, frames <= 75) is painted over with background;
  * the hand cursor (frames 54-66) is found by template matching and the cells
    under it are filled from the nearest frame where they are not covered.

Binary format (before gzip), little endian
-------------------------------------------
    for each frame:   for each cell (row-major, cols x rows):
        u8 n          number of runs (0..4)
        n x u8        (ring << 4) | paletteIndex   ring = 0..8 outer edge
Frame start offsets are in the JSON (also inlined into the TSX).
"""
import base64
import gzip
import json
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PITCH = 18.72          # grid pitch in source px
COLS = 57              # cells 0..56 (centres 12.2 .. 1060.5)
ROWS = 30              # cells -1..28
RINGS = 9              # 1.04px rings from the cell edge to its centre
MAX_RUNS = 4
INK_FRACTION = 0.4
DEDUPE_CELLS = 40       # frames differing in fewer cells are duplicates

BG = np.array([8, 8, 12], float)
BASES = {               # name -> RGB used to decompose palette entries
    "cream": np.array([232, 232, 216], float),
    "yellow": np.array([248, 192, 72], float),
    "red": np.array([248, 0, 0], float),
    "blue": np.array([31, 63, 255], float),
}
BASE_NAMES = list(BASES)

REST_FRAMES = (223, 234)     # clean rest pose used as the opening hold
MAIN_FRAMES = (54, 234)      # cut to close-up ... back to rest
REST_EXTRA_HOLD = 0.45       # s the opening rest pose is held before the cut
PILL_LAST = 75               # Save pill visible up to here
PILL_BOX = (0, 0, 96, 32)    # x0, y0, x1, y1
CURSOR_FRAMES = (54, 66)
CURSOR_TEMPLATE = (61, 534, 296, 32, 38)   # frame, x, y, w, h


def load(frames_dir, n):
    path = os.path.join(frames_dir, "frame_%04d.png" % n)
    return np.asarray(Image.open(path).convert("RGB")).astype(float)


# --------------------------------------------------------------------------
# grid phase
# --------------------------------------------------------------------------
def grid_phase(img):
    """Cell-centre phase (x, y) of the grid, from the luminance spectrum."""
    lum = img.mean(2)
    out = []
    for prof in (lum.sum(0), lum.sum(1)):
        idx = np.arange(len(prof))
        z = (prof * np.exp(2j * np.pi * idx / PITCH)).sum()
        out.append((np.angle(z) / (2 * np.pi) * PITCH) % PITCH)
    return out


# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
def nnls_small(A, b):
    """Non-negative least squares for a handful of columns (brute force)."""
    n = A.shape[1]
    best, best_err = np.zeros(n), np.inf
    for mask in range(1, 1 << n):
        cols = [i for i in range(n) if mask >> i & 1]
        x, *_ = np.linalg.lstsq(A[:, cols], b, rcond=None)
        if (x < 0).any():
            continue
        full = np.zeros(n)
        full[cols] = x
        err = ((A @ full - b) ** 2).sum()
        if err < best_err:
            best, best_err = full, err
    return best


def build_palette(frames_dir, frame_ids, k=15):
    counts = {}
    for f in frame_ids[::3]:
        px = (load(frames_dir, f).reshape(-1, 3) // 4).astype(int)
        u, n = np.unique(px, axis=0, return_counts=True)
        for c, m in zip(map(tuple, u), n):
            counts[c] = counts.get(c, 0) + m
    cols = np.array(list(counts), float) * 4 + 2
    w = np.array(list(counts.values()), float)
    # farthest-point init (weighted), then weighted k-means
    cents = [BG.copy()]
    for _ in range(k - 1):
        d = np.min([((cols - c) ** 2).sum(1) for c in cents], axis=0)
        cents.append(cols[np.argmax(d * np.sqrt(w))])
    C = np.array(cents)
    for _ in range(60):
        lab = np.argmin(((cols[:, None] - C[None]) ** 2).sum(2), 1)
        for i in range(1, k):            # entry 0 stays pinned to the bg
            m = lab == i
            if m.any():
                C[i] = (cols[m] * w[m, None]).sum(0) / w[m].sum()
    A = np.stack([BASES[n] - BG for n in BASE_NAMES], 1)
    weights = [nnls_small(A, c - BG) for c in C]
    # entries that are basically background collapse onto index 0
    keep = [0] + [i for i in range(1, k) if np.abs(C[i] - BG).max() > 22]
    C = C[keep]
    weights = [weights[i] for i in keep]
    weights[0] = np.zeros(4)
    return C, np.array(weights)


# --------------------------------------------------------------------------
# cell extraction
# --------------------------------------------------------------------------
def classify(img, C):
    flat = img.reshape(-1, 3)
    d = ((flat[:, None] - C[None]) ** 2).sum(2)
    return np.argmin(d, 1).reshape(img.shape[:2])


def cell_geometry(phx, phy, h, w):
    """For each pixel: cell index (col,row) and ring index."""
    ys, xs = np.mgrid[0:h, 0:w]
    px = xs + 0.5
    py = ys + 0.5
    # centre of col 0 is phx; row 0 (our row index 0 == grid row -1) is phy-PITCH
    fx = (px - phx) / PITCH + 0.5
    fy = (py - (phy - PITCH)) / PITCH + 0.5
    col = np.floor(fx).astype(int)
    row = np.floor(fy).astype(int)
    dx = np.abs(fx - col - 0.5)
    dy = np.abs(fy - row - 0.5)
    dist = np.maximum(dx, dy) * 2            # 0 centre .. 1 edge
    ring = np.minimum(RINGS - 1, np.floor(dist * RINGS)).astype(int)
    return col, row, ring


def extract(labels, valid, geom, npal):
    """Return runs[ROWS][COLS] (list of (ring, pal)) and a 'clean' mask."""
    col, row, ring = geom
    ok = (col >= 0) & (col < COLS) & (row >= 0) & (row < ROWS)
    cell = np.where(ok, row * COLS + col, -1)
    # histogram over (cell, ring, palette)
    key = (cell * RINGS + ring) * npal + labels
    sel = ok
    hist = np.bincount(key[sel], minlength=COLS * ROWS * RINGS * npal)
    hist = hist.reshape(COLS * ROWS, RINGS, npal)
    bad = np.bincount(cell[sel & ~valid], minlength=COLS * ROWS)
    clean = bad == 0
    runs = []
    # A ring is "ink" when enough of it is non-background: outlines are only
    # ~1px thick and often slightly rectangular, so a plain majority vote
    # would lose them to the background around/inside them.
    tot_all = hist.sum(2)
    ink = hist[:, :, 1:].sum(2)
    cls_all = np.where(ink >= INK_FRACTION * np.maximum(tot_all, 1),
                       np.argmax(hist[:, :, 1:], 2) + 1, 0)
    for c in range(COLS * ROWS):
        tot = tot_all[c]
        cls = cls_all[c].copy()
        # rings never sampled (off-screen half-cells) inherit the next one in
        for r in range(RINGS - 2, -1, -1):
            if tot[r] == 0:
                cls[r] = cls[r + 1]
        for r in range(1, RINGS):
            if tot[r] == 0:
                cls[r] = cls[r - 1]
        # outer -> inner runs
        rr = []
        for r in range(RINGS - 1, -1, -1):
            if rr and rr[-1][1] == cls[r]:
                continue
            rr.append([r, int(cls[r])])
        while rr and rr[0][1] == 0:          # leading background = nothing
            rr.pop(0)
        if rr and rr[-1][1] == 0 and len(rr) == 1:
            rr = []
        rr = simplify(rr)
        runs.append([tuple(x) for x in rr])
    return runs, clean


def simplify(rr):
    """Merge thinnest runs until there are at most MAX_RUNS."""
    while len(rr) > MAX_RUNS:
        widths = []
        for i, (r, _) in enumerate(rr):
            inner = rr[i + 1][0] if i + 1 < len(rr) else -1
            widths.append(r - inner)
        i = int(np.argmin(widths[1:])) + 1   # never drop the outermost run
        del rr[i]
        # neighbouring equal colours now merge
        j = 1
        while j < len(rr):
            if rr[j][1] == rr[j - 1][1]:
                del rr[j]
            else:
                j += 1
    return rr


# --------------------------------------------------------------------------
# artefacts
# --------------------------------------------------------------------------
def cursor_finder(frames_dir):
    f, x, y, w, h = CURSOR_TEMPLATE
    tmpl = load(frames_dir, f).mean(2)[y:y + h, x:x + w]
    kern = np.where(tmpl < 6, 1.0, -1.0)
    hand = (tmpl < 6).sum()

    def find(img):
        black = (img.mean(2) < 6).astype(float)
        K = np.zeros_like(black)
        K[:h, :w] = kern
        c = np.real(np.fft.ifft2(np.fft.fft2(black) * np.conj(np.fft.fft2(K))))
        yy, xx = np.unravel_index(np.argmax(c), c.shape)
        if c.max() < hand * 0.8:
            return None
        return xx, yy, w, h
    return find


# --------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    frames_dir = sys.argv[1]
    preview_dir = None
    if "--preview" in sys.argv:
        preview_dir = sys.argv[sys.argv.index("--preview") + 1]
        os.makedirs(preview_dir, exist_ok=True)

    manifest = json.load(open(os.path.join(frames_dir, "manifest.json")))
    times = {i + 1: fr["t"] for i, fr in enumerate(manifest["frames"])}

    # source timeline: clean rest hold, then cut -> close-up -> ... -> rest
    seq = []
    r0, r1 = REST_FRAMES
    for f in range(r0, r1 + 1):
        seq.append((f, times[f] - times[r0]))
    hold = times[r1] - times[r0] + REST_EXTRA_HOLD
    m0, m1 = MAIN_FRAMES
    for f in range(m0, m1 + 1):
        seq.append((f, hold + times[f] - times[m0]))
    total = seq[-1][1] + 1 / 15

    frame_ids = sorted({f for f, _ in seq})
    C, weights = build_palette(frames_dir, frame_ids)
    npal = len(C)
    print("palette (%d):" % npal)
    for c, wt in zip(C, weights):
        print("  ", c.round().astype(int).tolist(), np.round(wt, 2).tolist())

    find_cursor = cursor_finder(frames_dir)
    ph = [grid_phase(load(frames_dir, f)) for f in frame_ids[::4]]
    phx = float(np.median([p[0] for p in ph]))
    phy = float(np.median([p[1] for p in ph]))
    print("grid phase", round(phx, 2), round(phy, 2))

    baked = {}
    for f in frame_ids:
        img = load(frames_dir, f)
        valid = np.ones(img.shape[:2], bool)
        if f <= PILL_LAST:
            x0, y0, x1, y1 = PILL_BOX
            img[y0:y1, x0:x1] = BG
        if CURSOR_FRAMES[0] <= f <= CURSOR_FRAMES[1]:
            hit = find_cursor(img)
            if hit:
                x, y, w, h = hit
                valid[max(0, y - 3):y + h + 3, max(0, x - 3):x + w + 3] = False
        p = grid_phase(img)
        fx = p[0] if abs(p[0] - phx) < 1.2 else phx
        fy = p[1] if abs(p[1] - phy) < 1.2 else phy
        geom = cell_geometry(fx, fy, *img.shape[:2])
        baked[f] = extract(classify(img, C), valid, geom, npal)

    # fill cursor-covered cells from the nearest clean frame
    for f in frame_ids:
        runs, clean = baked[f]
        for c in np.nonzero(~clean)[0]:
            for dist in range(1, 40):
                cand = [g for g in (f + dist, f - dist)
                        if g in baked and g >= MAIN_FRAMES[0] and baked[g][1][c]]
                if cand:
                    runs[c] = baked[cand[0]][0][c]
                    break

    # drop duplicated source frames (the reference updates at ~13-20 fps)
    keys, ktimes, diffs = [], [], []
    prev = None
    for f, t in seq:
        runs = baked[f][0]
        if prev is not None:
            diff = sum(1 for a, b in zip(runs, prev) if a != b)
            diffs.append(diff)
            if diff < DEDUPE_CELLS:
                continue
        keys.append(runs)
        ktimes.append(t)
        prev = runs
    print("frame diffs:", sorted(diffs))
    print("keyframes:", len(keys), "of", len(seq), "duration %.2fs" % total)

    # encode
    buf = bytearray()
    offsets = []
    for runs in keys:
        offsets.append(len(buf))
        for rr in runs:
            buf.append(len(rr))
            for r, p in rr:
                buf.append((r << 4) | p)
    raw = bytes(buf)
    gz = gzip.compress(raw, 9, mtime=0)
    print("raw %d bytes, gzip %d bytes, base64 %d chars" %
          (len(raw), len(gz), (len(gz) + 2) // 3 * 4))

    meta = {
        "cols": COLS,
        "rows": ROWS,
        "rings": RINGS,
        "duration": round(total, 4),
        "restFrame": 0,
        "times": [round(t, 4) for t in ktimes],
        "offsets": offsets,
        "palette": [[round(float(x), 3) for x in w] for w in weights],
        "paletteBases": BASE_NAMES,
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "flower-frames.bin.gz"), "wb") as fh:
        fh.write(gz)
    with open(os.path.join(ROOT, "data", "flower-frames.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))

    inject(meta, base64.b64encode(gz).decode())

    if preview_dir:
        write_previews(preview_dir, keys, ktimes, weights, frames_dir, seq)


def inject(meta, b64):
    path = os.path.join(ROOT, "FlowerTransition.tsx")
    if not os.path.exists(path):
        print("FlowerTransition.tsx not found, skipping inline injection")
        return
    src = open(path).read()
    lines = [b64[i:i + 100] for i in range(0, len(b64), 100)]
    block = (
        "// BAKED DATA START (generated by tools/bake.py, do not edit)\n"
        "const BAKED_META = " + json.dumps(meta, separators=(",", ":")) + "\n"
        "const BAKED_GZ_BASE64 =\n" +
        "\n".join('    "%s" +' % l for l in lines)[:-2] + "\n"
        "// BAKED DATA END"
    )
    new, n = re.subn(r"// BAKED DATA START.*?// BAKED DATA END", lambda m: block,
                     src, flags=re.S)
    if n != 1:
        print("markers not found in FlowerTransition.tsx")
        return
    open(path, "w").write(new)
    print("injected data into FlowerTransition.tsx")


# --------------------------------------------------------------------------
# preview: re-render baked frames next to the originals (for checking)
# --------------------------------------------------------------------------
def render(runs, weights, pitch=PITCH, w=1056, h=540, phx=12.2, phy=16.5):
    cols = {i: np.clip(BG + sum(wt[j] * (BASES[n] - BG)
                                for j, n in enumerate(BASE_NAMES)), 0, 255)
            for i, wt in enumerate(weights)}
    img = np.zeros((h, w, 3)) + BG
    for c, rr in enumerate(runs):
        row, col = divmod(c, COLS)
        cx = phx + col * pitch
        cy = phy + (row - 1) * pitch
        for r, p in rr:
            half = (r + 1) / RINGS * pitch / 2
            x0, x1 = int(round(cx - half)), int(round(cx + half))
            y0, y1 = int(round(cy - half)), int(round(cy + half))
            img[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = cols[p]
    return img.astype(np.uint8)


def write_previews(out, keys, ktimes, weights, frames_dir, seq):
    for i in range(0, len(keys), max(1, len(keys) // 12)):
        t = ktimes[i]
        src = min(seq, key=lambda s: abs(s[1] - t))[0]
        a = load(frames_dir, src).astype(np.uint8)
        b = render(keys[i], weights)
        Image.fromarray(np.concatenate([a, b], 1)).save(
            os.path.join(out, "cmp_%03d.png" % i))


if __name__ == "__main__":
    main()
