// Demo harness for FlowerTransition outside Framer: npm run build:demo
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import FlowerTransition, {
    DEFAULT_SETTINGS,
    drawStill,
    FlowerSettings,
    playFlowerOutro,
} from "../FlowerTransition"

const PAGES = [
    { title: "Home", body: "Intro played, then faded out to reveal this page." },
    { title: "About", body: "Reached through the outro: cover, play, navigate, reveal." },
]

function useFps() {
    const [fps, setFps] = useState(0)
    useEffect(() => {
        let raf = 0
        let n = 0
        let last = performance.now()
        const tick = (now: number) => {
            n++
            if (now - last >= 500) {
                setFps(Math.round((n * 1000) / (now - last)))
                n = 0
                last = now
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [])
    return fps
}

function Slider(props: {
    label: string
    value: number
    min: number
    max: number
    step: number
    onChange: (v: number) => void
    unit?: string
}) {
    return (
        <label className="row">
            <span>{props.label}</span>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step}
                value={props.value}
                onChange={(e) => props.onChange(parseFloat(e.target.value))}
            />
            <output>
                {props.value}
                {props.unit || ""}
            </output>
        </label>
    )
}

function Color(props: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="row">
            <span>{props.label}</span>
            <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
            <output>{props.value}</output>
        </label>
    )
}

function Scrubber({ settings }: { settings: FlowerSettings }) {
    const ref = useRef<HTMLCanvasElement>(null)
    const [p, setP] = useState(0)
    useEffect(() => {
        if (ref.current) drawStill(ref.current, settings, p)
    }, [p, JSON.stringify(settings)])
    return (
        <div className="scrub">
            <canvas ref={ref} />
            <Slider label="Scrub" value={p} min={0} max={1} step={0.002} onChange={setP} />
        </div>
    )
}

function App() {
    const [s, setS] = useState<FlowerSettings>({ ...DEFAULT_SETTINGS })
    const [run, setRun] = useState(1)
    const [page, setPage] = useState(0)
    const [panel, setPanel] = useState(true)
    const fps = useFps()
    const set = (k: keyof FlowerSettings) => (v: any) => setS((o) => ({ ...o, [k]: v }))

    const outro = () =>
        playFlowerOutro(() => setPage((x) => (x + 1) % PAGES.length), s)

    return (
        <>
            <main className="page">
                <nav>
                    {PAGES.map((pg, i) => (
                        <a
                            key={pg.title}
                            href="#"
                            className={i === page ? "on" : ""}
                            onClick={(e) => {
                                e.preventDefault()
                                if (i !== page) outro()
                            }}
                        >
                            {pg.title}
                        </a>
                    ))}
                </nav>
                <h1>{PAGES[page].title}</h1>
                <p>{PAGES[page].body}</p>
                <p className="muted">
                    This page stands in for your Framer site. Use the panel to replay the
                    intro or run the outro.
                </p>
            </main>

            <FlowerTransition
                key={run}
                {...s}
                direction="intro"
                autoPlay
                playOnce={false}
            />

            <aside className={panel ? "panel" : "panel closed"}>
                <header>
                    <strong>Flower transition</strong>
                    <span className="fps">{fps} fps</span>
                    <button className="ghost" onClick={() => setPanel(!panel)}>
                        {panel ? "Hide" : "Show"}
                    </button>
                </header>
                {panel && (
                    <>
                        <div className="buttons">
                            <button onClick={() => setRun((r) => r + 1)}>Replay intro</button>
                            <button onClick={outro}>Play outro</button>
                        </div>
                        <Slider label="Duration" value={s.duration} min={0.4} max={8} step={0.1} unit="s" onChange={set("duration")} />
                        <Slider label="Fade" value={s.fadeDuration} min={0.1} max={2} step={0.05} unit="s" onChange={set("fadeDuration")} />
                        <label className="row">
                            <span>Style</span>
                            <select value={s.renderStyle} onChange={(e) => set("renderStyle")(e.target.value)}>
                                <option value="fine">Fine (halftone)</option>
                                <option value="classic">Classic (reference cells)</option>
                            </select>
                            <output />
                        </label>
                        <Slider label="Columns" value={s.cellColumns} min={40} max={260} step={1} onChange={set("cellColumns")} />
                        <Slider label="Portrait cols" value={s.mobileColumns} min={20} max={160} step={1} onChange={set("mobileColumns")} />
                        <Slider label="Dot size" value={s.dotSize} min={0.3} max={1} step={0.01} onChange={set("dotSize")} />
                        <Color label="Background" value={s.background} onChange={set("background")} />
                        <Color label="Cream" value={s.creamColor} onChange={set("creamColor")} />
                        <Color label="Red" value={s.redColor} onChange={set("redColor")} />
                        <Color label="Yellow" value={s.yellowColor} onChange={set("yellowColor")} />
                        <Color label="Blue" value={s.blueColor} onChange={set("blueColor")} />
                        <button className="ghost" onClick={() => setS({ ...DEFAULT_SETTINGS })}>
                            Reset
                        </button>
                        <Scrubber settings={s} />
                    </>
                )}
            </aside>
        </>
    )
}

createRoot(document.getElementById("root")!).render(<App />)

// handy for screenshots / debugging from the console:
// __drawStill(canvas, progress 0..1, { renderStyle: "classic" })
;(window as any).__drawStill = (c: HTMLCanvasElement, p: number, o: Partial<FlowerSettings> = {}) =>
    drawStill(c, { ...DEFAULT_SETTINGS, ...o }, p)
