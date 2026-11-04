# Soft Orb Lab

A soft, glowing orb that fills the window, flexes and shifts color, drawn by one WebGL fragment shader, with the controls floating over it. Open `index.html` in a browser; there's no build step.

- **Shape:** up to six hidden control points drift on slow looping paths. The outline is their circles melted together (a smooth union), so it bends as they move.
- **Color:** four colored lights wander inside the orb; each pixel blends toward the nearest ones. A bright rim sits just inside the edge, and a glow spills into the background.
- **Palettes:** Lagoon, Coral Reef, Sherbet, Violet Hour and Glacier, taken from Dan's reference screenshots (`_source/refs/`), plus Custom. Auto-cycle crossfades through them; Hue shift, Saturation and Brightness offset any palette.
- **Mouse:** the orb leans toward the cursor (a 7th control point between the center and the pointer) and brightens under it. Clicking drops a color splash: the next palette color, turned around the color wheel, spreading out with a soft ring and fading.
- **Hands:** Use camera tracks two hands with MediaPipe's Hand Landmarker (loaded from jsDelivr and Google's model store only when turned on; pinned to 0.10.35). Each hand is a wireframe borrowed from Neural Cascade (same 25 bones, six-sided tubes, fingertip domes) and acts like a mouse: the index fingertip leans the orb, a pinch splashes color. Camera frames stay in the browser. Needs https or localhost.
- **Grab and stretch:** a press or pinch on the orb holds that spot; moving drags the material (shape and colors) by warping the coordinates before the orb is drawn. Two grabs pulled apart thin the middle into a neck. Each grab is a spring: gooey while held, wobbling home on release. A quick press with no pull is a click, and splashes; with hands, any fingertip tapped to the thumb is a click (grabbing stays with the index finger).
- **Reduced motion:** everything moves at 15% speed and auto-cycle starts off.

Settings save in the browser; Copy settings exports them as JSON.

## Orb Home (`home.html`)

An experimental version of the danbenner.com homepage where every card is a soft orb in its own colors (picked from the live cards), over a drifting pastel background. Cards flex, lean toward the cursor and glow on hover; clicking splashes color. A Tune button adjusts flex, corner roundness, lean, glow, rim, drift and splash size. Copy and links are taken from the live homepage; danbenner.com itself is untouched.

**Videos:** seven cards play their homepage video inside the orb (`media/home/`, 640px 20-second silent loops re-encoded from assets.danbenner.com, 3.4 MB total). They're copied here because the asset host sends no CORS header, so WebGL can't read its videos directly. Videos only work over http(s); opened as a file, those cards fall back to their colors. Each orb draws in its own pass. Its shape is the rounded card with a gentle edge wobble that slowly swells out past the card and back as one piece (Swell, Pace), and hover builds over several seconds. Videos pause while their card is off screen.

**Text drift:** headlines turn and float in 3D over 38–64 seconds; buttons and tags rock about ±0.7°. Every element has its own timing. Both stop with reduced motion.
