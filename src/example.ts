/**
 * A built-in example image (drawn on a canvas, so the repo ships no
 * third-party photo): a lily-like flower on a soft gradient sky.
 */
export function exampleImage(): string {
    const W = 800,
        H = 1000
    const c = document.createElement("canvas")
    c.width = W
    c.height = H
    const ctx = c.getContext("2d")!

    const sky = ctx.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, "#7d93a8")
    sky.addColorStop(1, "#b9c3cb")
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, H)

    // stem and a leaf
    ctx.strokeStyle = "#b8483a"
    ctx.lineCap = "round"
    ctx.lineWidth = 12
    ctx.beginPath()
    ctx.moveTo(410, 470)
    ctx.bezierCurveTo(395, 640, 440, 820, 430, 1000)
    ctx.stroke()
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(425, 900)
    ctx.quadraticCurveTo(470, 760, 520, 690)
    ctx.stroke()

    const cx = 400,
        cy = 430
    // curled outer petals
    for (let i = 0; i < 9; i++) {
        const a = -Math.PI + (i / 8) * Math.PI + (i % 2 ? 0.08 : -0.05)
        const len = 210 + (i % 3) * 30
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(a)
        const g = ctx.createLinearGradient(0, 0, len, 0)
        g.addColorStop(0, "#9c0f14")
        g.addColorStop(0.6, "#e3222b")
        g.addColorStop(1, "#ff6a5c")
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(len * 0.35, -46, len * 0.8, -40, len, -8)
        ctx.bezierCurveTo(len * 1.05, 18, len * 0.9, 30, len * 0.82, 8)
        ctx.bezierCurveTo(len * 0.6, 20, len * 0.3, 26, 0, 0)
        ctx.fill()
        // curled tip
        ctx.strokeStyle = "#ff4b45"
        ctx.lineWidth = 7
        ctx.beginPath()
        ctx.arc(len * 0.95, -30, 24, Math.PI * 0.3, Math.PI * 1.6)
        ctx.stroke()
        // vein highlight
        ctx.strokeStyle = "rgba(255,220,210,0.55)"
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(10, -2)
        ctx.quadraticCurveTo(len * 0.5, -22, len * 0.92, -6)
        ctx.stroke()
        ctx.restore()
    }
    // long stamens
    ctx.strokeStyle = "#e8333a"
    ctx.lineWidth = 3
    for (let i = 0; i < 11; i++) {
        const a = -Math.PI * 0.95 + (i / 10) * Math.PI * 0.9
        const len = 260 + (i % 4) * 25
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.quadraticCurveTo(
            cx + Math.cos(a) * len * 0.6,
            cy + Math.sin(a) * len * 0.6 - 60,
            cx + Math.cos(a) * len,
            cy + Math.sin(a) * len - 30
        )
        ctx.stroke()
        ctx.fillStyle = "#ffd0c4"
        ctx.beginPath()
        ctx.arc(cx + Math.cos(a) * len, cy + Math.sin(a) * len - 30, 5, 0, Math.PI * 2)
        ctx.fill()
    }
    // dense centre
    const core = ctx.createRadialGradient(cx, cy - 10, 5, cx, cy, 90)
    core.addColorStop(0, "#5b0a0e")
    core.addColorStop(0.5, "#c3161f")
    core.addColorStop(1, "rgba(227,34,43,0)")
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(cx, cy, 90, 0, Math.PI * 2)
    ctx.fill()
    return c.toDataURL("image/png")
}
