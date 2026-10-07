/**
 * Standalone player for exported embeds:
 *
 *   PixelArtPlayer.mount(canvas, imageSrc, settings, { loop, autoplay })
 *
 * Sizes the canvas to its CSS box (devicePixelRatio aware), analyses the
 * image and plays the animation. The ending's revealed areas are transparent,
 * so whatever is behind the canvas shows through.
 */
import { analyze, Animator, DEFAULT_SETTINGS, Settings } from "./engine"

export interface PlayerOptions {
    loop?: boolean
    autoplay?: boolean
    /** seconds to hold the revealed end before looping */
    loopPause?: number
}

export interface PlayerHandle {
    play(): void
    pause(): void
    seek(t: number): void
    destroy(): void
}

export function mount(
    canvas: HTMLCanvasElement,
    src: string,
    settings: Partial<Settings>,
    opts: PlayerOptions = {}
): PlayerHandle {
    const s: Settings = { ...DEFAULT_SETTINGS, ...settings }
    let anim: Animator | null = null
    let raf = 0
    let playing = opts.autoplay !== false
    let t = 0
    let last = 0
    let destroyed = false

    const fit = () => {
        const r = canvas.getBoundingClientRect()
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        anim?.resize(Math.max(1, r.width) * dpr, Math.max(1, r.height) * dpr)
    }
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null

    const frame = (now: number) => {
        if (destroyed || !anim) return
        if (playing) {
            t += last ? Math.min(0.1, (now - last) / 1000) : 0
            const total = anim.timeline.total
            if (t >= total) {
                if (opts.loop) {
                    if (t >= total + (opts.loopPause ?? 0.8)) t = 0
                } else {
                    t = total
                    playing = false
                }
            }
        }
        last = now
        anim.render(Math.min(t, anim.timeline.total))
        raf = requestAnimationFrame(frame)
    }

    const img = new Image()
    img.onload = () => {
        if (destroyed) return
        anim = new Animator(canvas, analyze(img, s), s)
        ;(canvas as any).__anim = anim
        fit()
        ro?.observe(canvas)
        window.addEventListener("resize", fit)
        raf = requestAnimationFrame(frame)
    }
    img.src = src

    return {
        play() {
            if (anim && t >= anim.timeline.total) t = 0
            playing = true
        },
        pause() {
            playing = false
        },
        seek(x: number) {
            t = Math.max(0, x)
        },
        destroy() {
            destroyed = true
            cancelAnimationFrame(raf)
            ro?.disconnect()
            window.removeEventListener("resize", fit)
        },
    }
}
