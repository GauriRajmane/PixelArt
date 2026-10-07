// Minimal stand-in for the "framer" package so FlowerTransition.tsx can be
// bundled for demo.html outside Framer.
export const ControlType: Record<string, string> = new Proxy(
    {},
    { get: (_t, k) => String(k) }
)
export function addPropertyControls(_component: unknown, _controls: unknown) {}
export const RenderTarget = {
    canvas: "CANVAS",
    preview: "PREVIEW",
    current: () => "PREVIEW",
}
// no useRouter here: the override falls back to window.location
