import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import {
    analyze,
    Analysis,
    ANALYSIS_KEYS,
    Animator,
    Aspect,
    ASPECTS,
    DEFAULT_SETTINGS,
    Settings,
    STYLE_PRESETS,
    StyleName,
    timeline,
} from "./engine"
import { buildEmbedHTML, canRecordVideo, download, exportPNG, exportVideo } from "./export"
import { exampleImage } from "./example"

// ---------------------------------------------------------------------------
// small controls
// ---------------------------------------------------------------------------

function Row(props: { label: string; children: React.ReactNode; value?: React.ReactNode }) {
    return (
        <label className="row">
            <span className="row-label">{props.label}</span>
            <span className="row-control">{props.children}</span>
            {props.value !== undefined && <output>{props.value}</output>}
        </label>
    )
}

function Slider(props: {
    label: string
    value: number
    min: number
    max: number
    step: number
    unit?: string
    onChange: (v: number) => void
}) {
    const digits = props.step < 0.1 ? 2 : props.step < 1 ? 1 : 0
    return (
        <Row label={props.label} value={props.value.toFixed(digits) + (props.unit || "")}>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step}
                value={props.value}
                onChange={(e) => props.onChange(parseFloat(e.target.value))}
            />
        </Row>
    )
}

function ColorField(props: { label: string; value: string; onChange: (v: string) => void; allowTransparent?: boolean }) {
    const transparent = props.value === "transparent"
    return (
        <Row label={props.label} value={transparent ? "none" : props.value.toUpperCase()}>
            <span className="color">
                <input
                    type="color"
                    value={transparent ? "#000000" : props.value}
                    disabled={transparent}
                    onChange={(e) => props.onChange(e.target.value)}
                />
                {props.allowTransparent && (
                    <button
                        type="button"
                        className={"chip" + (transparent ? " on" : "")}
                        onClick={(e) => {
                            e.preventDefault()
                            props.onChange(transparent ? "#0A0C0D" : "transparent")
                        }}
                        title="Transparent: in embeds, the page behind shows through"
                    >
                        Transparent
                    </button>
                )}
            </span>
        </Row>
    )
}

function Segmented<T extends string>(props: {
    value: T
    options: { value: T; label: string }[]
    onChange: (v: T) => void
}) {
    return (
        <div className="segmented" role="radiogroup">
            {props.options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={props.value === o.value}
                    className={props.value === o.value ? "on" : ""}
                    onClick={() => props.onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <Row label={props.label}>
            <input
                type="checkbox"
                className="switch"
                checked={props.value}
                onChange={(e) => props.onChange(e.target.checked)}
            />
        </Row>
    )
}

function Section(props: { title: string; children: React.ReactNode }) {
    return (
        <section className="section">
            <h2>{props.title}</h2>
            {props.children}
        </section>
    )
}

// ---------------------------------------------------------------------------
// image loading
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Could not read that image."))
        img.src = src
    })
}

function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
    })
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------

const STORAGE_KEY = "pixelart:settings"

function initialSettings(): Settings {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
        if (saved && typeof saved === "object") return { ...DEFAULT_SETTINGS, ...saved }
    } catch {
        // storage unavailable: defaults
    }
    return { ...DEFAULT_SETTINGS }
}

function App() {
    const [s, setS] = useState<Settings>(initialSettings)
    const [image, setImage] = useState<{ el: HTMLImageElement; name: string } | null>(null)
    const [analysis, setAnalysis] = useState<Analysis | null>(null)
    const [playing, setPlaying] = useState(true)
    const [loop, setLoop] = useState(true)
    const [showMask, setShowMask] = useState(true)
    const [time, setTime] = useState(0)
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const [stageSize, setStageSize] = useState({ w: 640, h: 360 })

    const stageRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const maskRef = useRef<HTMLCanvasElement>(null)
    const animRef = useRef<Animator | null>(null)
    const timeRef = useRef(0)
    const playingRef = useRef(playing)
    playingRef.current = playing
    const loopRef = useRef(loop)
    loopRef.current = loop

    const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
        setS((o) => ({ ...o, [k]: v }))
    }, [])

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
        } catch {
            // ignore
        }
    }, [s])

    const tl = useMemo(() => timeline(s), [s])

    // --- image in
    const useSource = useCallback(async (src: string, name: string) => {
        setError(null)
        try {
            const el = await loadImage(src)
            setImage({ el, name })
            timeRef.current = 0
            setPlaying(true)
        } catch (e: any) {
            setError(e?.message || String(e))
        }
    }, [])

    const onFiles = useCallback(
        async (files: FileList | null) => {
            const f = files && files[0]
            if (!f) return
            if (!f.type.startsWith("image/")) {
                setError("That file isn't an image. Try a PNG, JPG or WebP.")
                return
            }
            useSource(await readFile(f), f.name)
        },
        [useSource]
    )

    useEffect(() => {
        useSource(exampleImage(), "Example flower")
    }, [useSource])

    // paste an image from the clipboard
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))
            const f = item?.getAsFile()
            if (f) readFile(f).then((src) => useSource(src, "Pasted image"))
        }
        window.addEventListener("paste", onPaste)
        return () => window.removeEventListener("paste", onPaste)
    }, [useSource])

    // --- analysis (only when the image or subject settings change)
    const analysisKey = ANALYSIS_KEYS.map((k) => String(s[k])).join("|")
    useEffect(() => {
        if (!image) return
        const id = setTimeout(() => setAnalysis(analyze(image.el, s)), 60)
        return () => clearTimeout(id)
    }, [image, analysisKey])

    // --- stage size: fit the aspect ratio into the available area
    useEffect(() => {
        const el = stageRef.current
        if (!el) return
        const fit = () => {
            const r = el.getBoundingClientRect()
            const ar = ASPECTS[s.aspect]
            let w = r.width,
                h = w / ar
            if (h > r.height) {
                h = r.height
                w = h * ar
            }
            setStageSize({ w: Math.floor(w), h: Math.floor(h) })
        }
        fit()
        const ro = new ResizeObserver(fit)
        ro.observe(el)
        return () => ro.disconnect()
    }, [s.aspect])

    // --- animator
    useEffect(() => {
        const c = canvasRef.current
        if (!c || !analysis) return
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        if (!animRef.current) {
            c.width = stageSize.w * dpr
            c.height = stageSize.h * dpr
            animRef.current = new Animator(c, analysis, s)
        } else {
            animRef.current.setAnalysis(analysis)
        }
    }, [analysis])

    useEffect(() => {
        animRef.current?.setSettings(s)
    }, [s])

    useEffect(() => {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        animRef.current?.resize(stageSize.w * dpr, stageSize.h * dpr)
    }, [stageSize])

    // --- playback loop
    useEffect(() => {
        let raf = 0
        let last = 0
        let shown = -1
        const frame = (now: number) => {
            const anim = animRef.current
            if (anim) {
                const total = anim.timeline.total
                if (playingRef.current) {
                    timeRef.current += last ? Math.min(0.1, (now - last) / 1000) : 0
                    if (timeRef.current >= total) {
                        if (loopRef.current) {
                            if (timeRef.current >= total + 0.8) timeRef.current = 0
                        } else {
                            timeRef.current = total
                            setPlaying(false)
                        }
                    }
                }
                anim.render(Math.min(timeRef.current, total))
                const rounded = Math.round(timeRef.current * 20) / 20
                if (rounded !== shown) {
                    shown = rounded
                    setTime(Math.min(timeRef.current, total))
                }
            }
            last = now
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf)
    }, [])

    // --- thumbnail: the source image, optionally with the detected subject
    // highlighted (background dimmed) to tune the cut-out
    useEffect(() => {
        const c = maskRef.current
        if (!c || !analysis || !image) return
        c.width = analysis.w
        c.height = analysis.h
        const ctx = c.getContext("2d")!
        ctx.drawImage(image.el, 0, 0, analysis.w, analysis.h)
        if (!showMask) return
        const id = ctx.getImageData(0, 0, analysis.w, analysis.h)
        for (let i = 0; i < analysis.mask.length; i++) {
            const m = analysis.mask[i] / 255
            const o = i * 4
            // subject: cyan wash; background: darkened
            id.data[o] = id.data[o] * (0.25 + 0.15 * m) + 127 * 0.6 * m
            id.data[o + 1] = id.data[o + 1] * (0.25 + 0.15 * m) + 227 * 0.6 * m
            id.data[o + 2] = id.data[o + 2] * (0.25 + 0.15 * m) + 238 * 0.6 * m
        }
        ctx.putImageData(id, 0, 0)
    }, [analysis, showMask, image])

    const setStyle = (style: StyleName) => setS((o) => ({ ...o, style, ...STYLE_PRESETS[style] }))

    const seek = (t: number) => {
        timeRef.current = t
        setTime(t)
        setPlaying(false)
    }

    const replay = () => {
        timeRef.current = 0
        setPlaying(true)
    }

    // --- exports
    const run = async (label: string, fn: () => Promise<void>) => {
        if (!image || busy) return
        setError(null)
        setBusy(label)
        try {
            await fn()
        } catch (e: any) {
            setError(e?.message || String(e))
        } finally {
            setBusy(null)
        }
    }
    const [videoSize, setVideoSize] = useState(1920)
    const [progress, setProgress] = useState(0)

    const onExportVideo = () =>
        run("Recording video", () =>
            exportVideo(image!.el, s, videoSize, (p) => setProgress(p)).finally(() => setProgress(0))
        )
    const onExportPNG = () => run("Saving frame", () => exportPNG(image!.el, s, time, videoSize))
    const onExportHTML = () =>
        run("Building embed", async () => {
            const html = await buildEmbedHTML(image!.el, s, loop)
            download(new Blob([html], { type: "text/html" }), "pixelart-embed.html")
        })
    const onCopyHTML = () =>
        run("Copying embed", async () => {
            const html = await buildEmbedHTML(image!.el, s, loop)
            await navigator.clipboard.writeText(html)
            setBusy("Copied")
            await new Promise((r) => setTimeout(r, 900))
        })

    const stageBg =
        s.endBackground === "transparent" ? undefined : ({ background: s.endBackground } as React.CSSProperties)

    return (
        <div
            className={"app" + (dragging ? " dragging" : "")}
            onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragging(false)
            }}
            onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                onFiles(e.dataTransfer.files)
            }}
        >
            <header className="top">
                <div className="brand">
                    <span className="logo" aria-hidden="true" />
                    PixelArt
                </div>
                <div className="file-name">{image ? image.name : "No image"}</div>
                <label className="button primary">
                    Upload image
                    <input type="file" accept="image/*" onChange={(e) => onFiles(e.target.files)} hidden />
                </label>
            </header>

            <main className="workspace">
                <div className="stage-wrap">
                    <div className="stage-area" ref={stageRef}>
                        <div
                            className={"stage" + (s.endBackground === "transparent" ? " checker" : "")}
                            style={{ width: stageSize.w, height: stageSize.h, ...stageBg }}
                        >
                            <canvas ref={canvasRef} style={{ width: stageSize.w, height: stageSize.h }} />
                        </div>
                        {dragging && <div className="drop-hint">Drop an image to animate it</div>}
                    </div>
                    <div className="transport">
                        <button
                            type="button"
                            className="icon"
                            onClick={() => (playing ? setPlaying(false) : time >= tl.total ? replay() : setPlaying(true))}
                            aria-label={playing ? "Pause" : "Play"}
                        >
                            {playing ? "❚❚" : "▶"}
                        </button>
                        <button type="button" className="icon" onClick={replay} aria-label="Replay">
                            ↺
                        </button>
                        <input
                            className="scrub"
                            type="range"
                            min={0}
                            max={tl.total}
                            step={0.01}
                            value={Math.min(time, tl.total)}
                            onChange={(e) => seek(parseFloat(e.target.value))}
                            aria-label="Timeline"
                        />
                        <span className="time">
                            {time.toFixed(1)} / {tl.total.toFixed(1)}s
                        </span>
                        <label className="loop">
                            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
                        </label>
                    </div>
                    {error && <div className="error">{error}</div>}
                </div>

                <aside className="panel">
                    <Section title="Image">
                        <div className="buttons">
                            <label className="button">
                                Upload…
                                <input type="file" accept="image/*" onChange={(e) => onFiles(e.target.files)} hidden />
                            </label>
                            <button type="button" className="button" onClick={() => useSource(exampleImage(), "Example flower")}>
                                Example
                            </button>
                        </div>
                        <canvas className="thumb" ref={maskRef} aria-label="Source image" />
                        <p className="hint">Drop, paste or upload. Works best with one subject on a plain background.</p>
                        <Toggle label="Remove background" value={s.removeBackground} onChange={(v) => set("removeBackground", v)} />
                        {s.removeBackground && (
                            <Slider label="Cut-out" value={s.threshold} min={0.03} max={0.5} step={0.01} onChange={(v) => set("threshold", v)} />
                        )}
                        <Toggle label="Invert subject" value={s.invertMask} onChange={(v) => set("invertMask", v)} />
                        <Toggle label="Show subject" value={showMask} onChange={setShowMask} />
                    </Section>

                    <Section title="Look">
                        <Segmented<StyleName>
                            value={s.style}
                            onChange={setStyle}
                            options={[
                                { value: "xray", label: "X-ray" },
                                { value: "classic", label: "Classic" },
                                { value: "photo", label: "Photo" },
                            ]}
                        />
                        {s.style === "xray" && <ColorField label="Tint" value={s.tint} onChange={(v) => set("tint", v)} />}
                        <ColorField label="Background" value={s.background} onChange={(v) => set("background", v)} />
                        <Slider label="Density" value={s.columns} min={60} max={360} step={2} onChange={(v) => set("columns", v)} />
                        <Slider label="Dot size" value={s.dotSize} min={0.3} max={1} step={0.01} onChange={(v) => set("dotSize", v)} />
                        <Slider label="Glow" value={s.glow} min={0.3} max={2.5} step={0.05} onChange={(v) => set("glow", v)} />
                    </Section>

                    <Section title="Motion">
                        <Slider label="Duration" value={s.duration} min={1} max={10} step={0.1} unit="s" onChange={(v) => set("duration", v)} />
                        <Slider label="Movement" value={s.motion} min={0} max={1.5} step={0.05} onChange={(v) => set("motion", v)} />
                        <Slider label="Depth" value={s.depth} min={0} max={1} step={0.05} onChange={(v) => set("depth", v)} />
                    </Section>

                    <Section title="Ending">
                        <Toggle label="Fill and reveal" value={s.ending} onChange={(v) => set("ending", v)} />
                        {s.ending && (
                            <>
                                <ColorField label="Fill colour" value={s.fillColor} onChange={(v) => set("fillColor", v)} />
                                <ColorField
                                    label="Reveals"
                                    value={s.endBackground}
                                    allowTransparent
                                    onChange={(v) => set("endBackground", v)}
                                />
                                <Slider label="Fill" value={s.fillDuration} min={0.2} max={2} step={0.05} unit="s" onChange={(v) => set("fillDuration", v)} />
                                <Slider label="Reveal" value={s.revealDuration} min={0.2} max={2.5} step={0.05} unit="s" onChange={(v) => set("revealDuration", v)} />
                            </>
                        )}
                    </Section>

                    <Section title="Export">
                        <Segmented<Aspect>
                            value={s.aspect}
                            onChange={(v) => set("aspect", v)}
                            options={(["16:9", "1:1", "4:5", "9:16"] as Aspect[]).map((a) => ({ value: a, label: a }))}
                        />
                        <Row label="Size" value={null}>
                            <select value={videoSize} onChange={(e) => setVideoSize(parseInt(e.target.value))}>
                                <option value={1280}>720p (1280 long side)</option>
                                <option value={1920}>1080p (1920 long side)</option>
                                <option value={2560}>1440p (2560 long side)</option>
                            </select>
                        </Row>
                        <div className="buttons grid">
                            <button type="button" className="button primary" disabled={!image || !!busy || !canRecordVideo()} onClick={onExportVideo}>
                                Video
                            </button>
                            <button type="button" className="button" disabled={!image || !!busy} onClick={onExportPNG}>
                                PNG frame
                            </button>
                            <button type="button" className="button" disabled={!image || !!busy} onClick={onExportHTML}>
                                Embed .html
                            </button>
                            <button type="button" className="button" disabled={!image || !!busy} onClick={onCopyHTML}>
                                Copy embed
                            </button>
                        </div>
                        {busy && (
                            <div className="busy">
                                {busy}
                                {progress > 0 && ` ${Math.round(progress * 100)}%`}
                                {progress > 0 && (
                                    <span className="bar">
                                        <span style={{ width: `${progress * 100}%` }} />
                                    </span>
                                )}
                            </div>
                        )}
                        <p className="hint">
                            Video records in real time ({tl.total.toFixed(1)}s). The embed is a single HTML file that plays
                            the animation. Paste it into a Framer <em>Embed</em> (HTML) or any page.
                        </p>
                    </Section>
                    <button type="button" className="button ghost reset" onClick={() => setS({ ...DEFAULT_SETTINGS })}>
                        Reset settings
                    </button>
                </aside>
            </main>
        </div>
    )
}

createRoot(document.getElementById("root")!).render(<App />)

// for debugging and automated checks
;(window as any).__pixelart = { DEFAULT_SETTINGS }
