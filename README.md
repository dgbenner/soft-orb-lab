# Soft Orb Lab

A soft, glowing orb that flexes and shifts color, drawn by one WebGL fragment shader. Open `index.html` in a browser; there's no build step.

- **Shape:** up to six hidden control points drift on slow looping paths. The outline is their circles melted together (a smooth union), so it bends as they move.
- **Color:** four colored lights wander inside the orb; each pixel blends toward the nearest ones. A bright rim sits just inside the edge, and a glow spills into the background.
- **Palettes:** Lagoon, Coral Reef, Sherbet, Violet Hour and Glacier, taken from Dan's reference screenshots (`_source/refs/`), plus Custom. Auto-cycle crossfades through them; Hue shift, Saturation and Brightness offset any palette.
- **Reduced motion:** everything moves at 15% speed and auto-cycle starts off.

Settings save in the browser; Copy settings exports them as JSON.
