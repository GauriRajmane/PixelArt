import type { ComponentType } from "react"
import { withFlowerTransition as withFlower } from "./FlowerTransition.tsx"

/**
 * Code override for nav links and buttons that link to another page:
 * plays the flower outro over the current page, then navigates with
 * Framer's router and reveals the new page.
 *
 * Settings (duration, colours, columns) come from the FlowerTransition
 * component on the current page, or the defaults if there is none.
 */
export function withFlowerTransition(Component): ComponentType {
    return withFlower(Component)
}
