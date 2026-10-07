import { analyze, Animator, ASPECTS, Settings } from "./engine"
import playerSource from "./generated/player-bundle"

export function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Output size for an aspect ratio, with the long side = `long` px. */
export function outputSize(s: Settings, long: number) {
    const r = ASPECTS[s.aspect]
    return r >= 1
        ? { w: long, h: Math.round(long / r / 2) * 2 }
        : { w: Math.round((long * r) / 2) * 2, h: long }
}

function composite(out: CanvasRenderingContext2D, src: HTMLCanvasElement, s: Settings) {
    const { width: w, height: h } = out.canvas
    out.clearRect(0, 0, w, h)
    if (s.endBackground !== "transparent") {
        out.fillStyle = s.endBackground
        out.fillRect(0, 0, w, h)
    }
    out.drawImage(src, 0, 0)
}

export async function exportPNG(img: HTMLImageElement, s: Settings, t: number, long = 1920) {
    const { w, h } = outputSize(s, long)
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    const anim = new Animator(c, analyze(img, s), s)
    anim.render(t)
    const out = document.createElement("canvas")
    out.width = w
    out.height = h
    composite(out.getContext("2d")!, c, s)
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"))
    if (blob) download(blob, "pixelart.png")
}

function pickMime(): string | null {
    const MR = (window as any).MediaRecorder
    if (!MR) return null
    for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"])
        if (MR.isTypeSupported?.(m)) return m
    return null
}

export function canRecordVideo() {
    return !!pickMime() && typeof HTMLCanvasElement.prototype.captureStream === "function"
}

/**
 * Record the full animation in real time with MediaRecorder.
 * onProgress gets 0..1. Resolves when the file has been downloaded.
 */
export async function exportVideo(
    img: HTMLImageElement,
    s: Settings,
    long: number,
    onProgress: (p: number) => void
) {
    const mime = pickMime()
    if (!mime) throw new Error("This browser can't record video (MediaRecorder unsupported).")
    const { w, h } = outputSize(s, long)
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    const anim = new Animator(c, analyze(img, s), s)
    const out = document.createElement("canvas")
    out.width = w
    out.height = h
    const octx = out.getContext("2d")!
    // video has no transparency: the reveal shows the end background
    const vs = { ...s, endBackground: s.endBackground === "transparent" ? s.background : s.endBackground }
    anim.render(0)
    composite(octx, c, vs)

    const stream = out.captureStream(60)
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise<void>((r) => (rec.onstop = () => r()))
    rec.start()

    const total = anim.timeline.total + 0.4 // hold the final frame briefly
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
        const frame = () => {
            const t = (performance.now() - t0) / 1000
            anim.render(Math.min(t, anim.timeline.total))
            composite(octx, c, vs)
            onProgress(Math.min(1, t / total))
            if (t >= total) resolve()
            else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
    })
    rec.stop()
    await done
    const ext = mime.includes("mp4") ? "mp4" : "webm"
    download(new Blob(chunks, { type: mime.split(";")[0] }), `pixelart.${ext}`)
}

/** Re-encode the source image small enough to embed (JPEG keeps it light). */
async function embeddableImage(img: HTMLImageElement, max = 900): Promise<string> {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement("canvas")
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    const ctx = c.getContext("2d")!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    // keep transparency if the image has any
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let alpha = false
    for (let i = 3; i < d.length; i += 4 * 16)
        if (d[i] < 250) {
            alpha = true
            break
        }
    return alpha ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9)
}

/** A self-contained HTML page that plays the animation (for embeds). */
export async function buildEmbedHTML(img: HTMLImageElement, s: Settings, loop: boolean): Promise<string> {
    const src = await embeddableImage(img)
    const bg = s.endBackground === "transparent" ? "transparent" : s.endBackground
    const settings = JSON.stringify(s)
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PixelArt animation</title>
<style>html,body{margin:0;height:100%;background:${bg};overflow:hidden}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas id="pixelart"></canvas>
<script>${playerSource.replace(/<\/script/gi, "<\\/script")}</script>
<script>
PixelArtPlayer.mount(document.getElementById("pixelart"), ${JSON.stringify(src)}, ${settings}, { loop: ${loop}, autoplay: true });
</script>
</body>
</html>
`
}
