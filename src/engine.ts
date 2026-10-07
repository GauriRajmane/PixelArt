/**
 * PixelArt engine: turns an image into a moving pixel animation.
 *
 *   image ──analyze──▶ point cloud (subject mask, edges, depth)
 *         ──camera path──▶ projected + splatted onto a fine grid
 *         ──style──▶ square dots on a <canvas>
 *         ──ending──▶ fill spreads from the subject, then the background
 *                      grows back in through it
 *
 * No dependencies; used by the creator app and by exported embeds.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type StyleName = "xray" | "classic" | "photo"
export type Aspect = "16:9" | "1:1" | "4:5" | "9:16"

export interface Settings {
    style: StyleName
    /** Dot colour for the X-ray style. */
    tint: string
    /** Canvas colour behind the dots while the animation plays. */
    background: string
    /** Colour that floods the frame at the ending. */
    fillColor: string
    /** What the ending reveals ("transparent" in embeds shows the page). */
    endBackground: string
    /** Dot columns across the frame. */
    columns: number
    /** Largest dot as a fraction of the grid pitch. */
    dotSize: number
    /** Exposure of the dot field. */
    glow: number

    /** Seconds of camera motion. */
    duration: number
    /** 0 = still, 1 = default path, up to 1.5 = more dramatic. */
    motion: number
    /** How much the subject bulges in 3D while rotating (0..1). */
    depth: number

    ending: boolean
    fillDuration: number
    revealDuration: number

    removeBackground: boolean
    /** Colour distance from the detected background that counts as subject. */
    threshold: number
    invertMask: boolean

    aspect: Aspect
}

export const STYLE_PRESETS: Record<StyleName, Partial<Settings>> = {
    xray: { tint: "#7FE3EE", background: "#0A0C0D", fillColor: "#7FE3EE" },
    classic: { background: "#08080C", fillColor: "#E8E8D8" },
    photo: { background: "#0B0B0B", fillColor: "#F2F2F2" },
}

export const DEFAULT_SETTINGS: Settings = {
    style: "xray",
    tint: "#7FE3EE",
    background: "#0A0C0D",
    fillColor: "#7FE3EE",
    endBackground: "#0A0C0D",
    columns: 220,
    dotSize: 0.78,
    glow: 1,
    duration: 4,
    motion: 1,
    depth: 0.6,
    ending: true,
    fillDuration: 0.7,
    revealDuration: 0.9,
    removeBackground: true,
    threshold: 0.16,
    invertMask: false,
    aspect: "16:9",
}

export const ASPECTS: Record<Aspect, number> = {
    "16:9": 16 / 9,
    "1:1": 1,
    "4:5": 4 / 5,
    "9:16": 9 / 16,
}

/** Settings that require re-analysing the image when they change. */
export const ANALYSIS_KEYS: (keyof Settings)[] = ["removeBackground", "threshold", "invertMask"]

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export function parseColor(c: string): [number, number, number] {
    const s = (c || "").trim()
    let m = /^#([0-9a-f]{3,8})$/i.exec(s)
    if (m) {
        let h = m[1]
        if (h.length <= 4) h = h.split("").map((x) => x + x).join("")
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
    if (m) return [+m[1], +m[2], +m[3]]
    return [0, 0, 0]
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => {
    const c = clamp01(x)
    return c * c * (3 - 2 * c)
}
const rgb = (r: number, g: number, b: number) =>
    `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`

// ---------------------------------------------------------------------------
// Image analysis
// ---------------------------------------------------------------------------

export interface Analysis {
    /** analysis raster size */
    w: number
    h: number
    /** points (subject pixels), normalised coords: longest side spans -1..1 */
    n: number
    x: Float32Array
    y: Float32Array
    /** 0..1 bulge (1 = deepest inside the subject) */
    z: Float32Array
    /** X-ray intensity: translucent body, bright edges and detail */
    ix: Float32Array
    /** solid intensity: filled body */
    is: Float32Array
    r: Uint8Array
    g: Uint8Array
    b: Uint8Array
    /** size of one analysis pixel in normalised units */
    unit: number
    /** subject bounds (centre and half size) in normalised units */
    cx: number
    cy: number
    hw: number
    hh: number
    /** subject mask preview (alpha 0..255), w x h */
    mask: Uint8ClampedArray
}

const ANALYSIS_MAX = 460

/** Median of a channel sample (for the background colour). */
function median(a: number[]) {
    const s = a.slice().sort((p, q) => p - q)
    return s[s.length >> 1] || 0
}

export function analyze(
    img: CanvasImageSource & { width: number; height: number },
    s: Pick<Settings, "removeBackground" | "threshold" | "invertMask">
): Analysis {
    const iw = (img as HTMLImageElement).naturalWidth || img.width
    const ih = (img as HTMLImageElement).naturalHeight || img.height
    const k = Math.min(1, ANALYSIS_MAX / Math.max(iw, ih))
    const w = Math.max(8, Math.round(iw * k))
    const h = Math.max(8, Math.round(ih * k))
    const cv = document.createElement("canvas")
    cv.width = w
    cv.height = h
    const ctx = cv.getContext("2d", { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    const N = w * h

    const L = new Float32Array(N)
    for (let i = 0; i < N; i++)
        L[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255

    // --- subject mask: distance from the background colour (median of the
    // border), soft threshold, then a small blur
    let alpha: Float32Array = new Float32Array(N)
    if (s.removeBackground) {
        // Background as a smooth gradient: colour profiles along bands just
        // inside each edge (skipping thin frames/borders), median-smoothed so
        // a subject touching an edge doesn't leak in, then blended across
        // the image like a Coons patch.
        const inset = Math.max(2, Math.round(Math.min(w, h) * 0.03))
        const band = Math.max(2, Math.round(Math.min(w, h) * 0.04))
        const edge = (len: number, at: (k: number, b: number) => number) => {
            const out = new Float32Array(len * 3)
            for (let k = 0; k < len; k++)
                for (let c = 0; c < 3; c++) {
                    const vals: number[] = []
                    for (let b = 0; b < band; b++) vals.push(data[at(k, inset + b) + c])
                    out[k * 3 + c] = median(vals)
                }
            // wide median along the edge
            const win = Math.max(3, Math.round(len * 0.12))
            const sm = new Float32Array(len * 3)
            for (let k = 0; k < len; k++)
                for (let c = 0; c < 3; c++) {
                    const vals: number[] = []
                    for (let q = Math.max(0, k - win); q <= Math.min(len - 1, k + win); q += 2) vals.push(out[q * 3 + c])
                    sm[k * 3 + c] = median(vals)
                }
            return sm
        }
        const px = (x: number, y: number) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4
        const top = edge(w, (x, b) => px(x, b))
        const bottom = edge(w, (x, b) => px(x, h - 1 - b))
        const left = edge(h, (y, b) => px(b, y))
        const right = edge(h, (y, b) => px(w - 1 - b, y))
        const t = s.threshold
        for (let y = 0; y < h; y++) {
            const v = y / (h - 1)
            for (let x = 0; x < w; x++) {
                const u = x / (w - 1)
                const i = y * w + x
                let d2 = 0
                for (let c = 0; c < 3; c++) {
                    const row = left[y * 3 + c] * (1 - u) + right[y * 3 + c] * u
                    const col = top[x * 3 + c] * (1 - v) + bottom[x * 3 + c] * v
                    const diff = data[i * 4 + c] - (row + col) / 2
                    d2 += diff * diff
                }
                const d = Math.sqrt(d2) / 255
                alpha[i] = smooth((d - t * 0.6) / (t * 0.8 + 1e-3))
            }
        }
        // the frame band itself (outside the inset) is never subject
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
                if (x < inset || y < inset || x >= w - inset || y >= h - inset) alpha[y * w + x] = 0
    } else {
        alpha.fill(1)
    }
    if (s.invertMask) for (let i = 0; i < N; i++) alpha[i] = 1 - alpha[i]
    // drop alpha below the image's own transparency
    for (let i = 0; i < N; i++) alpha[i] *= data[i * 4 + 3] / 255
    alpha = blur3(alpha, w, h)

    // --- edges (Sobel on the masked luminance, so the silhouette glows)
    const ML = new Float32Array(N)
    for (let i = 0; i < N; i++) ML[i] = (0.35 + 0.65 * L[i]) * alpha[i]
    const E = new Float32Array(N)
    for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
            const o = y * w + x
            const gx =
                ML[o - w + 1] + 2 * ML[o + 1] + ML[o + w + 1] - ML[o - w - 1] - 2 * ML[o - 1] - ML[o + w - 1]
            const gy =
                ML[o + w - 1] + 2 * ML[o + w] + ML[o + w + 1] - ML[o - w - 1] - 2 * ML[o - w] - ML[o - w + 1]
            E[o] = Math.sqrt(gx * gx + gy * gy)
        }
    // normalise by a high percentile so a few hard edges don't dominate
    const sample: number[] = []
    for (let i = 0; i < N; i += 7) if (alpha[i] > 0.05) sample.push(E[i])
    sample.sort((a, b) => a - b)
    const eRef = sample[Math.floor(sample.length * 0.97)] || 1
    for (let i = 0; i < N; i++) E[i] = Math.min(1, E[i] / eRef)

    // --- depth: distance inside the mask (chamfer), so the middle of the
    // subject bulges towards the camera when it rotates
    const D = new Float32Array(N)
    for (let i = 0; i < N; i++) D[i] = alpha[i] > 0.5 ? 1e9 : 0
    chamfer(D, w, h)
    let dMax = 0
    for (let i = 0; i < N; i++) if (D[i] < 1e8 && D[i] > dMax) dMax = D[i]

    // --- points
    let n = 0
    for (let i = 0; i < N; i++) if (alpha[i] > 0.04) n++
    const P = {
        x: new Float32Array(n),
        y: new Float32Array(n),
        z: new Float32Array(n),
        ix: new Float32Array(n),
        is: new Float32Array(n),
        r: new Uint8Array(n),
        g: new Uint8Array(n),
        b: new Uint8Array(n),
    }
    const half = Math.max(w, h) / 2
    let minX = 1e9,
        minY = 1e9,
        maxX = -1e9,
        maxY = -1e9
    const mask = new Uint8ClampedArray(N)
    let j = 0
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = y * w + x
            const a = alpha[i]
            mask[i] = a * 255
            if (a <= 0.04) continue
            const nx = (x + 0.5 - w / 2) / half
            const ny = (y + 0.5 - h / 2) / half
            P.x[j] = nx
            P.y[j] = ny
            const dz = dMax > 0 ? Math.min(1, D[i] / dMax) : 0
            P.z[j] = Math.sqrt(dz) * 0.85 + L[i] * 0.15
            P.ix[j] = a * (0.07 + 0.3 * L[i] + 1.15 * E[i])
            P.is[j] = a * (0.75 + 0.25 * L[i]) + 0.35 * E[i]
            P.r[j] = data[i * 4]
            P.g[j] = data[i * 4 + 1]
            P.b[j] = data[i * 4 + 2]
            if (a > 0.5) {
                if (nx < minX) minX = nx
                if (nx > maxX) maxX = nx
                if (ny < minY) minY = ny
                if (ny > maxY) maxY = ny
            }
            j++
        }
    if (minX > maxX) {
        minX = -w / 2 / half
        maxX = w / 2 / half
        minY = -h / 2 / half
        maxY = h / 2 / half
    }
    return {
        w,
        h,
        n,
        ...P,
        unit: 1 / half,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        hw: Math.max(0.05, (maxX - minX) / 2),
        hh: Math.max(0.05, (maxY - minY) / 2),
        mask,
    }
}

function blur3(a: Float32Array, w: number, h: number): Float32Array {
    const t = new Float32Array(a.length)
    const o = new Float32Array(a.length)
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = y * w + x
            const l = x > 0 ? a[i - 1] : a[i],
                r = x < w - 1 ? a[i + 1] : a[i]
            t[i] = (l + 2 * a[i] + r) / 4
        }
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = y * w + x
            const u = y > 0 ? t[i - w] : t[i],
                d = y < h - 1 ? t[i + w] : t[i]
            o[i] = (u + 2 * t[i] + d) / 4
        }
    return o
}

/** In-place two-pass chamfer distance (1, 1.4); seeds are 0, others 1e9. */
function chamfer(dist: Float32Array, nx: number, ny: number) {
    const D = 1.4
    for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
            const o = j * nx + i
            let v = dist[o]
            if (i > 0) v = Math.min(v, dist[o - 1] + 1)
            if (j > 0) {
                v = Math.min(v, dist[o - nx] + 1)
                if (i > 0) v = Math.min(v, dist[o - nx - 1] + D)
                if (i < nx - 1) v = Math.min(v, dist[o - nx + 1] + D)
            }
            dist[o] = v
        }
    for (let j = ny - 1; j >= 0; j--)
        for (let i = nx - 1; i >= 0; i--) {
            const o = j * nx + i
            let v = dist[o]
            if (i < nx - 1) v = Math.min(v, dist[o + 1] + 1)
            if (j < ny - 1) {
                v = Math.min(v, dist[o + nx] + 1)
                if (i < nx - 1) v = Math.min(v, dist[o + nx + 1] + D)
                if (i > 0) v = Math.min(v, dist[o + nx - 1] + D)
            }
            dist[o] = v
        }
}

// ---------------------------------------------------------------------------
// Camera path (modelled on the reference: rest, push in while turning,
// close-up, wide tilted sweep, settle back to rest)
// ---------------------------------------------------------------------------

interface Cam {
    yaw: number // degrees
    pitch: number
    roll: number
    zoom: number
    px: number // pan, in subject half-sizes
    py: number
    stretch: number // horizontal stretch
}

const KEYS: [number, Cam][] = [
    [0.0, { yaw: 0, pitch: 0, roll: 0, zoom: 1, px: 0, py: 0, stretch: 1 }],
    [0.1, { yaw: 4, pitch: -2, roll: 0, zoom: 1.04, px: 0, py: 0, stretch: 1 }],
    [0.3, { yaw: 32, pitch: -8, roll: -4, zoom: 2.1, px: 0.35, py: -0.3, stretch: 1 }],
    [0.48, { yaw: 48, pitch: 12, roll: -10, zoom: 3.0, px: 0.2, py: -0.45, stretch: 1 }],
    [0.68, { yaw: -34, pitch: 20, roll: 6, zoom: 1.55, px: -0.12, py: 0.05, stretch: 1.3 }],
    [0.86, { yaw: -8, pitch: 5, roll: 1, zoom: 1.06, px: 0, py: 0, stretch: 1.03 }],
    [1.0, { yaw: 0, pitch: 0, roll: 0, zoom: 1, px: 0, py: 0, stretch: 1 }],
]
const CAM_FIELDS: (keyof Cam)[] = ["yaw", "pitch", "roll", "zoom", "px", "py", "stretch"]

export function cameraAt(tau: number, motion: number): Cam {
    const t = clamp01(tau)
    let i = 0
    while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++
    const [t1, c1] = KEYS[i]
    const [t2, c2] = KEYS[i + 1]
    const c0 = KEYS[Math.max(0, i - 1)][1]
    const c3 = KEYS[Math.min(KEYS.length - 1, i + 2)][1]
    const u = (t - t1) / (t2 - t1)
    const out = {} as Cam
    for (const f of CAM_FIELDS) {
        // Catmull-Rom between key frames for smooth, continuous motion
        const p0 = c0[f],
            p1 = c1[f],
            p2 = c2[f],
            p3 = c3[f]
        const v =
            0.5 *
            (2 * p1 +
                (-p0 + p2) * u +
                (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
                (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
        const rest = KEYS[0][1][f]
        out[f] = rest + (v - rest) * motion
    }
    return out
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface Timeline {
    duration: number
    fillStart: number
    revealStart: number
    total: number
}

export function timeline(s: Settings): Timeline {
    const d = Math.max(0.2, s.duration)
    if (!s.ending) return { duration: d, fillStart: Infinity, revealStart: Infinity, total: d }
    // the fill starts during the last stretch of motion, the reveal before
    // the fill has finished, so nothing stops abruptly
    const fill = Math.max(0.05, s.fillDuration)
    const fillStart = d - Math.min(fill, d * 0.2)
    const revealStart = fillStart + fill * 0.7
    return { duration: d, fillStart, revealStart, total: revealStart + Math.max(0.05, s.revealDuration) }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Animator {
    private ctx: CanvasRenderingContext2D
    private W = 1
    private H = 1
    private pitch = 1
    private offX = 0
    private offY = 0
    private cols = 1
    private rows = 1
    private acc = new Float32Array(1)
    private accR = new Float32Array(1)
    private accG = new Float32Array(1)
    private accB = new Float32Array(1)
    private tmp = new Float32Array(1)
    private val = new Float32Array(1)
    private prev = new Float32Array(1)
    private hasPrev = false
    private delays: Float32Array | null = null
    private batches = new Map<number, number[]>()
    private strokes = new Map<number, number[]>()
    private colorCache = new Map<number, string>()
    private timelineCache: Timeline

    constructor(
        private canvas: HTMLCanvasElement,
        private a: Analysis,
        private s: Settings
    ) {
        this.ctx = canvas.getContext("2d")!
        this.timelineCache = timeline(s)
        this.resize(canvas.width, canvas.height)
    }

    get timeline() {
        return this.timelineCache
    }

    setAnalysis(a: Analysis) {
        this.a = a
        this.delays = null
        this.hasPrev = false
    }

    setSettings(s: Settings) {
        const gridChanged = s.columns !== this.s.columns
        this.s = s
        this.timelineCache = timeline(s)
        this.colorCache.clear()
        this.delays = null
        if (gridChanged) this.resize(this.W, this.H)
    }

    /** Size in device pixels. */
    resize(W: number, H: number) {
        this.W = Math.max(1, Math.round(W))
        this.H = Math.max(1, Math.round(H))
        if (this.canvas.width !== this.W) this.canvas.width = this.W
        if (this.canvas.height !== this.H) this.canvas.height = this.H
        // whole-pixel pitch: every cell is identical, so the gaps between
        // dots don't alternate 1px/2px and beat into a grid of lines
        this.pitch = Math.max(2, Math.round(this.W / Math.max(8, this.s.columns)))
        this.cols = Math.ceil(this.W / this.pitch)
        this.rows = Math.ceil(this.H / this.pitch)
        this.offX = Math.floor((this.W - this.cols * this.pitch) / 2)
        this.offY = Math.floor((this.H - this.rows * this.pitch) / 2)
        const n = this.cols * this.rows
        for (const k of ["acc", "accR", "accG", "accB", "tmp", "val", "prev"] as const)
            this[k] = new Float32Array(n)
        this.delays = null
        this.hasPrev = false
    }

    /** Pixels per normalised unit at rest (subject fits the frame). */
    private baseScale() {
        const a = this.a
        return Math.min((0.7 * this.H) / (2 * a.hh), (0.78 * this.W) / (2 * a.hw))
    }

    /** Project the point cloud for camera `cam` into this.val (0..1). */
    private computeField(tau: number) {
        const a = this.a,
            s = this.s
        const cam = cameraAt(tau, s.motion)
        const { cols, rows, pitch } = this
        const acc = this.acc,
            ar = this.accR,
            ag = this.accG,
            ab = this.accB
        acc.fill(0)
        const photo = s.style === "photo"
        if (photo) {
            ar.fill(0)
            ag.fill(0)
            ab.fill(0)
        }
        const I = s.style === "xray" ? a.ix : a.is

        const D2R = Math.PI / 180
        const cy = Math.cos(cam.yaw * D2R),
            sy = Math.sin(cam.yaw * D2R)
        const cp = Math.cos(cam.pitch * D2R),
            sp = Math.sin(cam.pitch * D2R)
        const cr = Math.cos(cam.roll * D2R),
            sr = Math.sin(cam.roll * D2R)
        const size = Math.max(a.hw, a.hh)
        const depth = s.depth * size * 0.9
        const f = size * 3.2 // perspective focal length
        const S = this.baseScale() * cam.zoom
        const panX = cam.px * a.hw,
            panY = cam.py * a.hh
        // each point carries the area of one analysis pixel; weight it by
        // that area in cells so brightness doesn't depend on zoom
        const unitPx = a.unit * S
        const wBase = ((unitPx * unitPx) / (pitch * pitch)) * cam.stretch
        const ox = (this.W / 2 - this.offX) / pitch - 0.5,
            oy = (this.H / 2 - this.offY) / pitch - 0.5
        const invP = S / pitch
        // distance between neighbouring points, in cells
        const spacing = unitPx * cam.stretch / pitch

        for (let i = 0; i < a.n; i++) {
            const X = a.x[i] - a.cx,
                Y = a.y[i] - a.cy,
                Z = a.z[i] * depth
            // yaw (around y), pitch (around x), roll (around z)
            const x1 = X * cy + Z * sy
            const z1 = -X * sy + Z * cy
            const y2 = Y * cp - z1 * sp
            const z2 = Y * sp + z1 * cp
            const x3 = x1 * cr - y2 * sr
            const y3 = x1 * sr + y2 * cr
            const persp = f / (f - z2)
            const gx = (x3 * cam.stretch - panX) * persp * invP + ox
            const gy = (y3 - panY) * persp * invP + oy
            const w = I[i] * wBase * persp * persp
            // zoomed in past the image detail, points land more than a cell
            // apart: splat a box as big as the point's footprint instead,
            // or the gaps show up as a grid of lines
            const spread = spacing * persp
            if (spread > 1.05) {
                this.splatBox(gx, gy, spread / 2, w, photo ? i : -1)
                continue
            }
            const ix = Math.floor(gx),
                iy = Math.floor(gy)
            if (ix < -1 || iy < -1 || ix >= cols || iy >= rows) continue
            const fx = gx - ix,
                fy = gy - iy
            // bilinear splat
            const w00 = w * (1 - fx) * (1 - fy),
                w10 = w * fx * (1 - fy),
                w01 = w * (1 - fx) * fy,
                w11 = w * fx * fy
            const o = iy * cols + ix
            const inX0 = ix >= 0,
                inX1 = ix + 1 < cols,
                inY0 = iy >= 0,
                inY1 = iy + 1 < rows
            if (inY0) {
                if (inX0) acc[o] += w00
                if (inX1) acc[o + 1] += w10
            }
            if (inY1) {
                if (inX0) acc[o + cols] += w01
                if (inX1) acc[o + cols + 1] += w11
            }
            if (photo) {
                const r = a.r[i],
                    g = a.g[i],
                    b = a.b[i]
                if (inY0 && inX0) {
                    ar[o] += w00 * r
                    ag[o] += w00 * g
                    ab[o] += w00 * b
                }
                if (inY0 && inX1) {
                    ar[o + 1] += w10 * r
                    ag[o + 1] += w10 * g
                    ab[o + 1] += w10 * b
                }
                if (inY1 && inX0) {
                    ar[o + cols] += w01 * r
                    ag[o + cols] += w01 * g
                    ab[o + cols] += w01 * b
                }
                if (inY1 && inX1) {
                    ar[o + cols + 1] += w11 * r
                    ag[o + cols + 1] += w11 * g
                    ab[o + cols + 1] += w11 * b
                }
            }
        }

        // soften: [1 2 1] blur fills gaps when zoomed past the image detail
        const t = this.tmp,
            v = this.val
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++) {
                const o = y * cols + x
                t[o] = (acc[x > 0 ? o - 1 : o] + 2 * acc[o] + acc[x < cols - 1 ? o + 1 : o]) / 4
            }
        const gain = (s.style === "xray" ? 2.1 : 2.4) * s.glow
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++) {
                const o = y * cols + x
                const b = (t[y > 0 ? o - cols : o] + 2 * t[o] + t[y < rows - 1 ? o + cols : o]) / 4
                v[o] = 1 - Math.exp(-b * gain)
            }
    }

    /** Area-weighted splat of a square footprint (half size r, in cells). */
    private splatBox(gx: number, gy: number, r: number, w: number, pi: number) {
        const { cols, rows } = this
        const x0 = gx - r + 0.5,
            x1 = gx + r + 0.5,
            y0 = gy - r + 0.5,
            y1 = gy + r + 0.5
        const cx0 = Math.max(0, Math.floor(x0)),
            cx1 = Math.min(cols - 1, Math.floor(x1))
        const cy0 = Math.max(0, Math.floor(y0)),
            cy1 = Math.min(rows - 1, Math.floor(y1))
        if (cx0 > cx1 || cy0 > cy1) return
        // footprint covers several cells: each gets the share of the point's
        // weight it overlaps (w is "per cell fully covered" already scaled by
        // the point area, so divide by the footprint area in cells)
        const norm = w / (4 * r * r)
        const a = this.a
        for (let y = cy0; y <= cy1; y++) {
            const oy = Math.min(y + 1, y1) - Math.max(y, y0)
            if (oy <= 0) continue
            for (let x = cx0; x <= cx1; x++) {
                const ox = Math.min(x + 1, x1) - Math.max(x, x0)
                if (ox <= 0) continue
                const ww = norm * ox * oy
                const o = y * cols + x
                this.acc[o] += ww
                if (pi >= 0) {
                    this.accR[o] += ww * a.r[pi]
                    this.accG[o] += ww * a.g[pi]
                    this.accB[o] += ww * a.b[pi]
                }
            }
        }
    }

    private color(key: number, make: () => string) {
        let c = this.colorCache.get(key)
        if (!c) this.colorCache.set(key, (c = make()))
        return c
    }

    private push(map: Map<number, number[]>, key: number, x: number, y: number, w: number, h: number) {
        let l = map.get(key)
        if (!l) map.set(key, (l = []))
        l.push(x, y, w, h)
    }

    /** Dots for the current field in the active style. */
    private drawDots() {
        const ctx = this.ctx,
            s = this.s
        const { cols, rows, pitch } = this
        const v = this.val,
            prev = this.prev
        const maxHalf = (pitch * Math.max(0.15, Math.min(1, s.dotSize))) / 2
        const batches = this.batches,
            strokes = this.strokes
        batches.forEach((l) => (l.length = 0))
        strokes.forEach((l) => (l.length = 0))
        const bg = parseColor(s.background)
        const tint = parseColor(s.tint)
        const cream = parseColor(s.fillColor)

        for (let j = 0; j < rows; j++) {
            const cy = this.offY + (j + 0.5) * pitch
            for (let i = 0; i < cols; i++) {
                const o = j * cols + i
                const val = v[o]
                if (val < 0.025) continue
                const cx = this.offX + (i + 0.5) * pitch
                let key = 0
                let half = maxHalf * (0.2 + 0.8 * Math.sqrt(val))
                if (s.style === "xray") {
                    key = Math.min(31, Math.floor(val * 32))
                } else if (s.style === "photo") {
                    const wsum = this.acc[o] || 1e-6
                    const q = (c: number) => Math.min(15, Math.max(0, Math.round(c / wsum / 17)))
                    key = (q(this.accR[o]) << 8) | (q(this.accG[o]) << 4) | q(this.accB[o])
                    half = maxHalf * Math.sqrt(val)
                } else {
                    // classic: cream body, motion fringes, hollow halo
                    const d = this.hasPrev ? val - prev[o] : 0
                    if (val < 0.22) {
                        const hs = maxHalf * (0.3 + val * 2.2)
                        this.push(strokes, 0, cx - hs, cy - hs, hs * 2, hs * 2)
                        continue
                    }
                    key = d > 0.07 ? 1 : d < -0.07 ? 3 : Math.abs(d) > 0.03 || val < 0.45 ? 2 : 0
                    half = val > 0.6 ? maxHalf : maxHalf * (0.5 + val * 0.8)
                }
                const x = Math.round(cx - half),
                    y = Math.round(cy - half)
                this.push(batches, key, x, y, Math.max(1, Math.round(cx + half) - x), Math.max(1, Math.round(cy + half) - y))
            }
        }

        ctx.fillStyle = s.background
        ctx.fillRect(0, 0, this.W, this.H)
        batches.forEach((list, key) => {
            if (!list.length) return
            let fill: string
            if (s.style === "xray") {
                fill = this.color(key, () => {
                    const t = (key + 0.5) / 32
                    const m = Math.min(1, t * 1.15)
                    const wt = Math.max(0, (t - 0.72) / 0.28) * 0.55
                    const c = [0, 1, 2].map((ch) => {
                        const base = bg[ch] + (tint[ch] - bg[ch]) * m
                        return base + (255 - base) * wt
                    })
                    return rgb(c[0], c[1], c[2])
                })
            } else if (s.style === "photo") {
                fill = this.color(key, () => rgb(((key >> 8) & 15) * 17, ((key >> 4) & 15) * 17, (key & 15) * 17))
            } else {
                fill = this.color(key, () =>
                    key === 1 ? "#F80000" : key === 2 ? "#F8C048" : key === 3 ? "#1F3FFF" : rgb(cream[0], cream[1], cream[2])
                )
            }
            ctx.fillStyle = fill
            ctx.beginPath()
            for (let k = 0; k < list.length; k += 4) ctx.rect(list[k], list[k + 1], list[k + 2], list[k + 3])
            ctx.fill()
        })
        const st = strokes.get(0)
        if (st && st.length) {
            ctx.strokeStyle = "rgba(205,191,167,0.75)"
            ctx.lineWidth = Math.max(1, pitch * 0.09)
            ctx.beginPath()
            for (let k = 0; k < st.length; k += 4) ctx.rect(st[k], st[k + 1], st[k + 2], st[k + 3])
            ctx.stroke()
        }
        // keep this frame for the classic style's motion fringes
        this.prev.set(v)
        this.hasPrev = true
    }

    /** Fill timing: cells inside the subject first, outward by distance. */
    private fillDelays(): Float32Array {
        if (this.delays) return this.delays
        const tl = this.timelineCache
        this.computeField(Math.min(1, tl.fillStart / tl.duration))
        const { cols, rows } = this
        const dist = new Float32Array(cols * rows)
        for (let o = 0; o < dist.length; o++) dist[o] = this.val[o] > 0.35 ? 0 : 1e9
        chamfer(dist, cols, rows)
        let max = 0
        for (let o = 0; o < dist.length; o++) if (dist[o] < 1e8 && dist[o] > max) max = dist[o]
        const d = new Float32Array(cols * rows)
        // deterministic jitter so exports and previews match
        let seed = 1234567
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let o = 0; o < d.length; o++) {
            const n = dist[o] > 1e8 ? 1 : max > 0 ? dist[o] / max : 0
            d[o] = Math.min(1, Math.sqrt(n) * 0.85 + rnd() * 0.15)
        }
        this.delays = d
        return d
    }

    /** Growing squares cell by cell; painted (fill) or punched out (reveal). */
    private drawCells(amount: number, erase: boolean) {
        const ctx = this.ctx
        const d = this.fillDelays()
        const { cols, rows, pitch } = this
        const SPAN = 0.35
        ctx.fillStyle = erase ? "#000" : this.s.fillColor
        if (erase) ctx.globalCompositeOperation = "destination-out"
        ctx.beginPath()
        for (let j = 0; j < rows; j++) {
            const cy = this.offY + (j + 0.5) * pitch
            for (let i = 0; i < cols; i++) {
                const local = (amount - d[j * cols + i] * (1 - SPAN)) / SPAN
                if (local <= 0) continue
                if (local >= 0.85) {
                    ctx.rect(this.offX + i * pitch, this.offY + j * pitch, pitch, pitch)
                    continue
                }
                const cx = this.offX + (i + 0.5) * pitch
                const hs = (pitch / 2) * 1.08 * smooth(local / 0.85)
                if (hs < 0.4) continue
                const x = Math.round(cx - hs),
                    y = Math.round(cy - hs)
                ctx.rect(x, y, Math.max(1, Math.round(cx + hs) - x), Math.max(1, Math.round(cy + hs) - y))
            }
        }
        ctx.fill()
        if (erase) ctx.globalCompositeOperation = "source-over"
    }

    /** Render time t (seconds). Revealed areas are transparent. */
    render(t: number) {
        const tl = this.timelineCache
        const ctx = this.ctx
        const fillP = clamp01((t - tl.fillStart) / Math.max(0.05, this.s.fillDuration))
        const revealP = clamp01((t - tl.revealStart) / Math.max(0.05, this.s.revealDuration))
        const eased = fillP * (0.6 + 0.4 * fillP)
        if (revealP >= 1) {
            ctx.clearRect(0, 0, this.W, this.H)
            return
        }
        if (eased >= 1) {
            ctx.fillStyle = this.s.fillColor
            ctx.fillRect(0, 0, this.W, this.H)
        } else {
            this.computeField(Math.min(1, t / tl.duration))
            this.drawDots()
            if (eased > 0) this.drawCells(eased, false)
        }
        if (revealP > 0) this.drawCells(revealP, true)
    }
}
