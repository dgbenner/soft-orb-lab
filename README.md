# Soft Orb Lab

A soft, glowing orb that flexes and shifts color, drawn by one WebGL fragment shader. Open `index.html` in a browser; there's no build step.

- **Shape:** up to six hidden control points drift on slow looping paths. The outline is their circles melted together (a smooth union), so it bends as they move.
- **Color:** four colored lights wander inside the orb; each pixel blends toward the nearest ones. A bright rim sits just inside the edge, and a glow spills into the background.
- **Palettes:** Lagoon, Coral Reef, Sherbet, Violet Hour and Glacier, taken from Dan's reference screenshots (`_source/refs/`), plus Custom. Auto-cycle crossfades through them; Hue shift, Saturation and Brightness offset any palette.
- **Mouse:** the orb leans toward the cursor (a 7th control point between the center and the pointer) and brightens under it. Clicking drops a color splash: the next palette color, turned around the color wheel, spreading out with a soft ring and fading.
- **Reduced motion:** everything moves at 15% speed and auto-cycle starts off.

Settings save in the browser; Copy settings exports them as JSON.

## Orb Home (`home.html`)

An experimental version of the danbenner.com homepage where every card is a soft orb in its own colors (picked from the live cards), over a drifting pastel background. Cards flex, lean toward the cursor and glow on hover; clicking splashes color. A Tune button adjusts flex, corner roundness, lean, glow, rim, drift and splash size. Copy and links are taken from the live homepage; danbenner.com itself is untouched.
