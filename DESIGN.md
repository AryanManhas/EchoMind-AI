# Design System Specification: The Ethereal Immersive

## 1. Overview & Creative North Star: "The Celestial Prism"
The Creative North Star for this design system is **"The Celestial Prism."** We are moving away from the static, "flat" dark mode interfaces of the past decade. Instead, we are building an environment that feels like a physical space carved out of light and shadow.

This system rejects the "boxed-in" layout. By utilizing intentional asymmetry, deep tonal layering, and high-contrast typography, we create a high-end editorial experience. We treat the screen not as a flat surface, but as a deep, luminous void where content floats in a state of weightless immersion. The goal is to make the user feel like they are interacting with a living organism of light—fluid, responsive, and premium.

---

## 2. Colors: Tonal Depth & The Aurora Glow
Our palette is rooted in the deep obsidian of the cosmos, punctuated by the high-energy vibration of "Aurora" accents.

### The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders are strictly prohibited for sectioning. Structural boundaries must be defined exclusively through:
*   **Background Shifts:** Transitioning from `surface` (#0e0e12) to `surface-container-low` (#131317).
*   **Tonal Transitions:** Using subtle gradients to suggest an edge rather than drawing one.

### Surface Hierarchy & Nesting
Treat the UI as a series of nested, frosted layers. 
*   **Base:** `surface` (#0e0e12)
*   **Low Importance:** `surface-container-low` (#131317)
*   **Primary Content Containers:** `surface-container` (#19191e)
*   **Floating/Active Elements:** `surface-container-highest` (#25252b)

### The "Glass & Gradient" Rule
To achieve the signature "Celestial Prism" look, use `surface-variant` (#25252b) at 40-60% opacity with a `backdrop-filter: blur(20px)`. This "Glassmorphism" creates a sense of luxury. 

**Signature Texture:** Main CTAs and Hero backgrounds must utilize a gradient transition from `primary` (#c799ff) to `primary-container` (#bc87fe). This creates a "glow" that feels three-dimensional and emits light onto surrounding surfaces.

---

## 3. Typography: Editorial Authority
The typography scale is designed to create a rhythmic, editorial flow, balancing the technical precision of Inter with the character of Manrope.

*   **Display (Manrope):** Use `display-lg` (3.5rem) for hero statements. These should be tracked slightly tight (-2%) to feel like a premium magazine masthead.
*   **Headline (Manrope):** `headline-lg` through `sm` are your primary storytelling tools. Use these to break the grid—try left-aligning a headline while the body text is inset further right.
*   **Body (Inter):** `body-lg` (1rem) is our workhorse. Inter provides the modern, clean sans-serif legibility required for deep dark-mode immersion.
*   **Labels (Plus Jakarta Sans):** `label-md` (0.75rem) should be used for technical metadata or overlines. Plus Jakarta Sans adds a "tech-luxe" feel to the smallest details.

---

## 4. Elevation & Depth: Tonal Layering
In this design system, elevation is a property of light, not physics.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface-container-lowest` (#000000) card placed on a `surface-container-low` (#131317) background creates a "recessed" look, while the inverse creates "lift."
*   **Ambient Shadows:** When an element must float, use an extremely diffused shadow: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4)`. The shadow color should never be pure black; it should be a deep tint of the background to maintain the "Aura" effect.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility, use `outline-variant` (#48474c) at **15% opacity**. This creates a suggestion of an edge without breaking the immersion.

---

## 5. Components: Fluid Primitives

### Buttons
*   **Primary:** A vibrant gradient from `primary` to `primary-fixed-dim`. 0.5rem (DEFAULT) corner radius. No border. White text (`on-primary-fixed`).
*   **Secondary:** Translucent `surface-variant` at 20% with a 1px "Ghost Border." High-blur backdrop filter.
*   **Tertiary:** Plain text using `secondary` (#4af8e3) with a subtle "Aurora" outer glow on hover.

### Cards & Lists
*   **The Card Rule:** No borders, no dividers. Use `surface-container-high` for card backgrounds. 
*   **Lists:** Separate items using 16px of vertical whitespace. If a separator is required, use a 1px tall gradient that fades to 0% opacity at both ends, rather than a solid line.

### Input Fields
*   **Style:** `surface-container-lowest` backgrounds with a `primary` (#c799ff) "glow" bottom-border (2px) only when focused. 
*   **Error States:** Use `error` (#ff6e84). The error message should appear as if it is "blooming" from the field, using a soft glow effect.

### Selection Controls (Chips/Radio/Check)
*   **Chips:** Use `xl` (1.5rem) roundedness. Selected states should use the `secondary` (#4af8e3) color to provide a "vibrant energy" contrast against the purple/black base.

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical layouts. Let an image overlap a container boundary to create "The Celestial Prism" depth.
*   **Do** use the `secondary` color (#4af8e3) sparingly for high-action "success" moments or key data points. It is your "electric" accent.
*   **Do** embrace negative space. Dark mode feels cramped quickly; give every element 20% more breathing room than you think it needs.

### Don't
*   **Don't** use 100% white text on a black background. Use `on-surface` (#fcf8fe) which is slightly off-white to prevent "halation" (visual buzzing).
*   **Don't** use sharp 90-degree corners. Everything in this system follows the Roundedness Scale—at minimum `sm` (0.25rem), but preferably `DEFAULT` (0.5rem).
*   **Don't** use standard "drop shadows" with high opacity. They kill the glassmorphism effect. Shadows must feel like ambient occlusion, not ink.
