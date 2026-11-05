// Orb Home renderer. Three passes per frame:
//   1. background: the homepage grey with pastel lights drifting through it
//   2. one pass per visible card: a soft orb in the card's colors, or its video, drawn on a quad that
//      extends well past the card. At rest the orbs stay apart; an engaged orb reaches over its
//      neighbors, so it is drawn a second time on top, faded in, which avoids any pop in the stacking
//   3. click splashes over everything
(() => {
  const DEFAULTS = { flex: 10, swell: 16, reach: 46, space: 64, textmove: 2.6, textgrow: 4, hoverpull: 26, dragpull: 1, memory: 25, blowtime: 2, pace: 0.45, radius: 30, lean: 36, glow: 0.8, rim: 0.5, drift: 1, splash: 1, video: 0.85 };
  const T = Object.assign({}, DEFAULTS);
  try { const s = JSON.parse(localStorage.getItem('orb-home:v4') || 'null'); if (s) for (const k in DEFAULTS) if (typeof s[k] === 'number') T[k] = s[k]; } catch (e) {}
  const save = () => { try { localStorage.setItem('orb-home:v4', JSON.stringify(T)); } catch (e) {} };
  const rmq = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- colors ----------
  const hexToRgb = (h) => { const n = parseInt(h.trim().slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); };
  const toLin = (c) => c.map((v) => Math.pow(v, 2.2));
  function rgbToHsl([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hslToRgb([h, s, l]) {
    if (!s) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }

  // ---------- WebGL setup ----------
  const canvas = document.getElementById('bg');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  function program(vs, fs, names) {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; names.forEach((n) => (u[n] = gl.getUniformLocation(p, n)));
    return { p, u, a: gl.getAttribLocation(p, 'a') };
  }
  const COMMON = `
    precision highp float;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 toGamma(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }`;
  const FULL_VS = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';

  // 1. Background
  const BG = program(FULL_VS, COMMON + `
    uniform vec2 uRes; uniform float uDpr, uT;
    uniform vec3 uBase; uniform vec3 uCol[4]; uniform vec2 uLight[4]; uniform vec3 uCursor;
    void main() {
      vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
      vec2 vp = uRes / uDpr;
      vec2 u = p / max(vp.x, vp.y);
      vec3 c = vec3(0.0); float w = 0.0;
      for (int j = 0; j < 4; j++) { float k = 1.0 / (pow(length(u - uLight[j]), 1.6) + 0.08); c += uCol[j] * k; w += k; }
      vec3 col = mix(uBase, c / w, 0.7);
      vec2 cd = p - uCursor.xy;
      col *= 1.0 + 0.07 * uCursor.z * exp(-dot(cd, cd) / 40000.0);
      gl_FragColor = vec4(toGamma(col) + (hash(gl_FragCoord.xy + fract(uT) * 91.0) - 0.5) / 255.0 * 1.5, 1.0);
    }`, ['uRes', 'uDpr', 'uT', 'uBase', 'uCol', 'uLight', 'uCursor']);

  // 2. One orb. The quad covers the card plus a wide margin; output is premultiplied for blending.
  const MARGIN = 280, MARGIN_ACTIVE = 460;
  const ORB = program(`
    attribute vec2 a; uniform vec4 uBox; uniform vec2 uView; varying vec2 vP;
    void main() {
      vP = uBox.xy + a * uBox.zw;
      gl_Position = vec4(vP.x / uView.x * 2.0 - 1.0, 1.0 - vP.y / uView.y * 2.0, 0.0, 1.0);
    }`, COMMON + `
    varying vec2 vP;
    uniform vec4 uRect;              // center, half size (CSS px, y down)
    uniform vec4 uMeta;              // corner radius, hover, seed, video strength (0 = none)
    uniform vec3 uPal[3];            // main, its close neighbor, contrast highlight
    uniform vec3 uCursor;
    uniform float uT, uFlex, uSwell, uReach, uLean, uGlow, uRim, uVidAspect, uFade, uMargin;
    uniform vec4 uBump[8];           // where each pull is held (card-relative px), and how far it has moved
    uniform float uBumpR[8];         // each pull's radius; 0 = unused
    uniform sampler2D uVid;

    float sdRoundBox(vec2 q, vec2 b, float r) { vec2 d = abs(q) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
    float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

    void main() {
      vec2 q0 = vP - uRect.xy;
      // Pulls: bend the space before anything is drawn, so edge, colors and video all stretch together.
      vec2 q = q0;
      for (int b = 0; b < 8; b++) {
        float br = uBumpR[b];
        if (br > 0.0) { vec2 rel = q0 - uBump[b].xy; q -= uBump[b].zw * exp(-dot(rel, rel) / (2.0 * br * br)); }
      }
      vec2 hs = uRect.zw;
      float s = uMeta.z * 6.2831, hov = uMeta.y, t = uT;
      float m = min(hs.x, hs.y);

      // Smooth body: the rounded card with a gentle, low wobble along its edge.
      vec2 un = q / hs;
      float wob = sin(un.x * 1.8 + t * 0.8 + s) * 0.5 + sin(un.y * 2.2 - t * 0.65 + s * 1.7) * 0.5
                + sin((un.x - un.y) * 1.3 + t * 1.05 + s * 2.3) * 0.35;
      float d = sdRoundBox(q, hs, uMeta.x) - wob * uFlex;

      // Swell: the whole orb breathes out past its card and back, as one shape, leaning a little further
      // toward a direction that slowly turns.
      float breathe = 0.5 - 0.5 * cos(t * 0.21 + s * 2.0);
      vec2 leanDir = vec2(cos(t * 0.09 + s * 3.1), sin(t * 0.07 + s * 1.9));
      float side = dot(q / (length(q) + 1.0), leanDir);
      d -= uSwell * breathe * (0.75 + 0.45 * side);

      // Engaged: the whole orb grows out over the gap and onto its neighbors.
      d -= uReach * hov * (0.7 + 0.3 * breathe);

      // Hover: the orb slowly reaches toward the pointer.
      vec2 cq = uCursor.xy - uRect.xy;
      vec2 dq = q - cq;
      float near = exp(-dot(dq, dq) / (2.0 * 240.0 * 240.0));
      d -= uLean * hov * (0.35 + 0.65 * near);

      float inside = 1.0 - smoothstep(-3.0, 3.0, d);

      // Inside color: the two close colors melt into each other across the body...
      vec2 nearAt = vec2(sin(t * 0.24 + s + 1.7), cos(t * 0.21 + s * 1.3 + 2.1)) * hs * 0.7;
      vec2 nearD = (q - nearAt) / hs;
      vec3 ic = mix(uPal[0], uPal[1], exp(-dot(nearD, nearD) / 0.9) * 0.95);
      // ...and the contrast color is one highlight, kept toward the right side, away from the text.
      vec2 hlAt = vec2(0.66 + 0.26 * sin(t * 0.17 + s), 0.7 * cos(t * 0.13 + s * 1.3)) * hs;
      float hlSize = max(m * 0.42, 72.0) * (1.0 + 0.35 * hov);
      float hl = exp(-dot(q - hlAt, q - hlAt) / (2.0 * hlSize * hlSize));
      ic = mix(ic, uPal[2], hl * 0.92);

      // Video: fills the body and warps along with it.
      vec3 body = ic;
      if (uMeta.w > 0.0) {
        vec2 uv = q / (2.0 * hs);
        float ca = hs.x / hs.y;
        uv = uVidAspect > ca ? vec2(uv.x * ca / uVidAspect, uv.y) : vec2(uv.x, uv.y * uVidAspect / ca);
        uv *= 0.78;                                    // leaves room so bulges still land on the picture
        float warp = uFlex / 26.0;
        uv += 0.018 * warp * vec2(sin(q.y / 70.0 + t * 0.9 + s), cos(q.x / 85.0 - t * 0.7 + s));
        uv += 0.06 * warp * (q / (length(q) + 1.0)) * smoothstep(-80.0, 0.0, d);   // stretches toward the rim
        vec3 vc = texture2D(uVid, clamp(vec2(uv.x + 0.5, 0.5 - uv.y), 0.001, 0.999)).rgb;
        vc = pow(vc, vec3(2.2));
        float edge = smoothstep(-90.0, 0.0, d);       // fade into the card's colors toward the edge
        body = mix(vc, ic, clamp(1.0 - uMeta.w + edge * 0.55, 0.0, 1.0));
        // Past the picture's own edge the orb is all color, so a grown orb never smears the video.
        float pic = 1.0 - smoothstep(0.40, 0.5, max(abs(uv.x), abs(uv.y)));
        body = mix(ic, body, pic);
        body = mix(body, uPal[2], hl * 0.45);
      }

      // A slight darkening toward the center, skipped on near-white cards so logos sit cleanly on them.
      float pale = smoothstep(0.65, 0.9, min(uPal[0].r, min(uPal[0].g, uPal[0].b)));
      body *= mix(0.88 + 0.12 * smoothstep(-70.0, 0.0, d), 1.0, pale) * (1.0 + 0.22 * hov * near);
      float rim = exp(-pow(min(d, 0.0) / 13.0, 2.0)) * inside;
      body += ic * rim * uRim * 0.6 + vec3(rim * uRim * 0.07);

      // Outside: a soft glow in the card's colors and a faint shadow below.
      float halo = exp(-max(d, 0.0) / 26.0) * uGlow * (0.45 + 0.55 * hov) * (1.0 - inside) * 0.55;
      float ds = sdRoundBox(q - vec2(0.0, 14.0), hs, uMeta.x);
      float shade = 0.08 * exp(-max(ds, 0.0) / 28.0) * (1.0 - inside) * (1.0 - halo);

      // Fade the quad's own border so the margin never shows as a hard edge.
      vec2 boxH = hs + uMargin;
      float border = smoothstep(0.0, 40.0, min(boxH.x - abs(q0.x), boxH.y - abs(q0.y)));

      vec3 outRgb = toGamma(body) * inside + toGamma(ic) * halo;
      float outA = max(inside, halo + shade);
      gl_FragColor = vec4(outRgb, outA) * border * uFade;
    }`, ['uBox', 'uView', 'uRect', 'uMeta', 'uPal', 'uCursor', 'uT', 'uFlex', 'uSwell', 'uReach', 'uLean', 'uGlow', 'uRim', 'uVidAspect', 'uVid', 'uFade', 'uMargin', 'uBump', 'uBumpR']);

  // 3. Splashes
  const SPL = program(FULL_VS, COMMON + `
    uniform vec2 uRes; uniform float uDpr;
    uniform vec4 uSplash[8]; uniform vec3 uSplashCol[8];
    void main() {
      vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
      vec3 rgb = vec3(0.0); float a = 0.0;
      for (int k = 0; k < 8; k++) {
        vec4 S = uSplash[k];
        if (S.z < 1.0) {
          float dist = length(p - S.xy);
          float rad = S.w * (0.2 + 0.8 * (1.0 - pow(1.0 - S.z, 3.0)));
          float fade = pow(1.0 - S.z, 1.6);
          float fw = exp(-pow(dist / rad, 2.0)) * fade * 0.7;
          vec3 c = toGamma(uSplashCol[k]);
          rgb = rgb * (1.0 - fw) + c * fw; a = a + fw - a * fw;
          rgb += c * exp(-pow((dist - rad) / (14.0 + 0.12 * S.w), 2.0)) * fade * 0.16;
        }
      }
      gl_FragColor = vec4(rgb, a);
    }`, ['uRes', 'uDpr', 'uSplash', 'uSplashCol']);

  const fullBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fullBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  function use(prog, buf) {
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(prog.a);
    gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0);
  }

  // ---------- cards and their videos ----------
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // Three colors per card, listed in data-pal: main, its close neighbor, contrast highlight.
  const cards = [...document.querySelectorAll('.orb')].map((el, i) => {
    const hex = el.dataset.pal.split(',').map((h) => h.trim());
    const c = { el, hex, pal: hex.map((h) => toLin(hexToRgb(h))), seed: (i * 0.6180339) % 1, hover: 0, text: 0, textCss: '', dwell: 0, play: 0, slow: null, hoverAt: [0, 0], hoverD: [0, 0], hoverR: 0, pulls: [], blow: 0, blowT: 0, base: null, edgeDelay: [0, 0, 0, 0], burstAngle: [0, 0, 0], engaged: false, onScreen: false, hasVid: false, vid: null };
    if (el.dataset.video) {
      const v = document.createElement('video');
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', src: `media/home/${el.dataset.video}.mp4` });
      v.setAttribute('aria-hidden', 'true');
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      c.vid = { v, tex, ready: false, broken: false, aspect: 16 / 9, w: 0, h: 0 };
      v.addEventListener('loadeddata', () => { c.vid.aspect = v.videoWidth / v.videoHeight; if (rmq.matches) v.currentTime = 2; });
    }
    return c;
  });

  // Play videos only while their card is on or near the screen.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const c = cards.find((x) => x.el === e.target);
      if (!c || !c.vid || rmq.matches) continue;
      if (e.isIntersecting) c.vid.v.play().catch(() => {}); else c.vid.v.pause();
    }
  }, { rootMargin: '200px' });
  cards.forEach((c) => c.vid && io.observe(c.el));

  function uploadVideo(c) {
    const V = c.vid;
    if (V.broken || V.v.readyState < 2) return false;
    gl.bindTexture(gl.TEXTURE_2D, V.tex);
    try {
      if (V.w !== V.v.videoWidth || V.h !== V.v.videoHeight) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, V.v);
        V.w = V.v.videoWidth; V.h = V.v.videoHeight;
      } else if (!V.v.paused || !V.ready) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, V.v);
      }
      V.ready = true;
    } catch (e) {
      V.broken = true;   // e.g. opened from a file:// URL, where the browser won't share video pixels
      console.warn('Video unavailable for this card; showing its colors instead.', e.message);
    }
    return V.ready;
  }

  // Background lights
  const BG_BASE = toLin(hexToRgb('#edeef0'));
  const BG_COLS = new Float32Array(['#d6edf0', '#e6e0f3', '#f4e5da', '#dcefe2'].flatMap((h) => toLin(hexToRgb(h))));
  const BG_HEX = ['#7fd0d8', '#a99ae0', '#f0a77a', '#7fc79a'];

  let dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }

  // ---------- pointer and clicks ----------
  const ptr = { x: -9999, y: -9999, inside: false, presence: 0 };
  addEventListener('pointermove', (e) => {
    // Firefox can report a false position when a drag leaves the window; keep the last good one.
    if (press && e.clientX <= 0 && e.clientY < 0) return;
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => (ptr.inside = false));
  const splashes = new Array(8).fill(null);
  let splashNext = 0, bgTurn = 0;
  function splashAt(card, pageX, pageY) {
    // Inside a card a click splashes that card's highlight color.
    const [h, s, l] = rgbToHsl(hexToRgb(card ? card.hex[2] : BG_HEX[bgTurn++ % BG_HEX.length]));
    const col = toLin(hslToRgb(card ? [h, s, l] : [h, Math.min(1, s * 1.15 + 0.15), Math.min(0.7, Math.max(0.35, l))]));
    splashes[splashNext] = { x: pageX, y: pageY, t0: performance.now(), col, r: (card ? 170 : 240) * T.splash };
    splashNext = (splashNext + 1) % splashes.length;
  }

  // ---------- drag: press inside a card to hold that spot, then pull the goo ----------
  const MAX_PULLS = 4, TAP_MOVE = 6, TAP_MS = 450;
  let press = null;
  function startPull(c, x, y) {
    const r = c.el.getBoundingClientRect();
    const ax = x - (r.left + r.width / 2), ay = y - (r.top + r.height / 2);
    // Make the pull wide enough to reach the nearest edge, so that side is what flexes.
    const toEdge = Math.max(0, Math.min(r.width / 2 - Math.abs(ax), r.height / 2 - Math.abs(ay)));
    if (c.pulls.length >= MAX_PULLS) { c.pulls.sort((p, q) => Math.hypot(q.dx, q.dy) - Math.hypot(p.dx, p.dy)); c.pulls.pop(); }
    // Keep a slot free: once they are nearly used up, the oldest shape starts relaxing faster.
    if (c.pulls.length >= MAX_PULLS - 1) c.pulls[0].fast = true;
    const pull = { ax, ay, dx: 0, dy: 0, vx: 0, vy: 0, r0: Math.max(110, toEdge + 50), held: true, fast: false };
    c.pulls.push(pull);
    return pull;
  }
  addEventListener('pointerdown', (e) => {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
    if (e.target.closest('a, button, input, .tune')) return;
    if (blownCard) { closeCard(); return; }
    const card = cards.find((c) => c.el.contains(e.target));
    if (!card) { splashAt(null, e.pageX, e.pageY); return; }
    if (e.button) return;
    press = { card, id: e.pointerId, x0: e.clientX, y0: e.clientY, pageX: e.pageX, pageY: e.pageY, t0: performance.now(), moved: false, pull: startPull(card, e.clientX, e.clientY) };
    try { card.el.setPointerCapture(e.pointerId); } catch (err) {}
  });
  addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > TAP_MOVE) { press.moved = true; document.body.classList.add('dragging'); }
  }, { passive: true });
  function endPress(e, canTap) {
    if (!press || e.pointerId !== press.id) return;
    const { card, pull, moved, t0, pageX, pageY } = press;
    press = null;
    pull.held = false;
    document.body.classList.remove('dragging');
    if (canTap && !moved && performance.now() - t0 < TAP_MS) {
      card.pulls.splice(card.pulls.indexOf(pull), 1);
      splashAt(card, pageX, pageY);
      openCard(card, e.clientX, e.clientY);
    }
  }
  addEventListener('pointerup', (e) => endPress(e, true));
  addEventListener('pointercancel', (e) => endPress(e, false));
  document.addEventListener('dragstart', (e) => { if (e.target.closest('.orb')) e.preventDefault(); });

  // ---------- click: the card balloons until it fills the screen ----------
  let blownCard = null;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // Ease in and out with a pull back before it goes and a slight overshoot at the end.
  const backInOut = (x) => { const s = 1.2 * 1.525; x *= 2; return x < 1 ? 0.5 * x * x * ((s + 1) * x - s) : 0.5 * ((x -= 2) * x * ((s + 1) * x + s) + 2); };
  function measureBase(c) {
    c.el.style.transform = '';
    const r = c.el.getBoundingClientRect();
    c.base = { l: r.left + scrollX, t: r.top + scrollY, w: r.width, h: r.height };
  }
  function openCard(c, x, y) {
    if (blownCard) return;
    measureBase(c);
    c.pulls.forEach((p) => { p.fast = true; });   // any shape on the card melts away as it opens
    const b = c.base, L = b.l - scrollX, Tp = b.t - scrollY;
    // The side nearest the click goes first; the others follow late, which makes the odd proportions.
    const dist = [x - L, y - Tp, L + b.w - x, Tp + b.h - y];
    const order = [0, 1, 2, 3].sort((p, q) => dist[p] - dist[q]);
    const steps = [0, 0.07, 0.15, 0.24];
    order.forEach((edge, i) => (c.edgeDelay[edge] = steps[i]));
    const a0 = Math.atan2(y - (Tp + b.h / 2), x - (L + b.w / 2));
    c.burstAngle = [a0, a0 + 2.3, a0 + 4.2];
    c.blowT = 1;
    blownCard = c;
    c.el.classList.add('is-blown');
    document.body.classList.add('blowing');
  }
  function closeCard() {
    if (!blownCard) return;
    blownCard.blowT = 0;
    document.body.classList.remove('blowing');
  }
  // The card's shape at the current point of the balloon. It runs the same path out and back, so it
  // can turn around at any moment without a jump.
  function blowRect(c, vw, vh) {
    const b = c.base, p = c.blow, over = 120;
    const edge = (i) => { const d = c.edgeDelay[i]; return backInOut(clamp01((p - d) / (1 - d))); };
    const L0 = b.l - scrollX, T0 = b.t - scrollY;
    const left = L0 + (-over - L0) * edge(0), top = T0 + (-over - T0) * edge(1);
    const right = L0 + b.w + (vw + over - L0 - b.w) * edge(2), bottom = T0 + b.h + (vh + over - T0 - b.h) * edge(3);
    return { left, top, right: Math.max(right, left + 40), bottom: Math.max(bottom, top + 40), width: Math.max(right - left, 40), height: Math.max(bottom - top, 40) };
  }
  // The card's text comes along: it stretches oddly on the way, then settles at an even, larger scale.
  function placeContent(c, vw, vh) {
    const b = c.base, p = c.blow;
    if (p <= 0) { c.el.style.transform = ''; return; }
    const e = backInOut(clamp01((p - 0.06) / 0.94)), mid = rmq.matches ? 0 : Math.sin(Math.PI * p);
    const big = Math.max(1, Math.min((vw * 0.62) / b.w, (vh * 0.62) / b.h));
    const s = 1 + (big - 1) * e, tx = (vw / 2 - (b.l - scrollX + b.w / 2)) * e, ty = (vh / 2 - (b.t - scrollY + b.h / 2)) * e;
    c.el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(s * (1 + 0.22 * mid)).toFixed(4)}, ${(s * (1 - 0.16 * mid)).toFixed(4)})`;
  }
  // Nothing behind the opened card should scroll.
  addEventListener('wheel', (e) => { if (blownCard) e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', (e) => { if (blownCard) e.preventDefault(); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!blownCard) return;
    if (e.key === 'Escape') closeCard();
    else if ([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) e.preventDefault();
  });
  addEventListener('resize', () => { if (blownCard) measureBase(blownCard); });

  // ---------- the card's contents bend with the goo ----------
  // Long text is split into words so a line curves across a pull. Anything with its own rocking motion
  // gets a wrapper, which takes the bend while the element inside keeps rocking.
  function splitWords(el) {
    for (const node of [...el.childNodes]) {
      if (node.nodeType !== 3) continue;
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
        const w = document.createElement('span');
        w.className = 'word';
        w.textContent = part;
        frag.appendChild(w);
      });
      el.replaceChild(frag, node);
    }
  }
  function setWords(el, text) { el.textContent = text; splitWords(el); }
  cards.forEach((c) => {
    c.el.querySelectorAll('h2, h3, .quote, .who, .contact p').forEach(splitWords);
    c.el.querySelectorAll('.cta, .tags span, .quote-nav button, .pills a, .pills button').forEach((el) => {
      const wrap = document.createElement('div');
      wrap.className = 'goo';
      el.replaceWith(wrap);
      wrap.appendChild(el);
    });
    c.gooOn = false;
    c.items = null;
  });
  const LOOSE_ITEMS = '.word, .goo, .wordmark, .specialties li, .logos img, .certs a';
  // Where each piece sits in the page layout, ignoring every transform, measured from the card's center.
  function measureItems(c) {
    c.items = [...c.el.querySelectorAll(LOOSE_ITEMS)].map((el) => {
      let x = 0, y = 0, e = el;
      while (e && e !== c.el) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
      return { el, x: x + el.offsetWidth / 2 - c.el.offsetWidth / 2, y: y + el.offsetHeight / 2 - c.el.offsetHeight / 2 };
    });
  }
  const remeasure = () => cards.forEach((c) => { c.items = null; });
  addEventListener('resize', remeasure);
  document.fonts?.ready.then(remeasure);

  const pullRadius = (p) => Math.max(p.r0, Math.hypot(p.dx, p.dy) * 1.25);
  const bends = [];
  function bendContents(c) {
    bends.length = 0;
    if (c.hoverR > 0) bends.push([c.hoverAt[0], c.hoverAt[1], c.hoverD[0], c.hoverD[1], c.hoverR]);
    for (const p of c.pulls) bends.push([p.ax, p.ay, p.dx, p.dy, pullRadius(p)]);
    if (!bends.length) {
      if (c.gooOn) { c.items?.forEach((it) => { it.el.style.transform = ''; }); c.gooOn = false; }
      return;
    }
    if (!c.items) measureItems(c);
    c.gooOn = true;
    for (const it of c.items) {
      // The orb's shader asks "which point of the flat card lands here?" The text needs the reverse:
      // where does this point of the flat card land? A few rounds of guessing converge on it.
      let x = it.x, y = it.y;
      for (let n = 0; n < 6; n++) {
        let nx = it.x, ny = it.y;
        for (const [bx, by, dx, dy, r] of bends) {
          const w = Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * r * r));
          nx += dx * w; ny += dy * w;
        }
        x = nx; y = ny;
      }
      // How the bend stretches and turns the space right here, applied to the piece of text.
      let a = 1, b = 0, cc = 0, d = 1;
      for (const [bx, by, dx, dy, r] of bends) {
        const rx = x - bx, ry = y - by, w = Math.exp(-(rx * rx + ry * ry) / (2 * r * r)) / (r * r);
        a += dx * rx * w; cc += dx * ry * w; b += dy * rx * w; d += dy * ry * w;
      }
      const det = Math.max(a * d - b * cc, 0.15);
      it.el.style.transform = `matrix(${(d / det).toFixed(3)}, ${(-b / det).toFixed(3)}, ${(-cc / det).toFixed(3)}, ${(a / det).toFixed(3)}, ${(x - it.x).toFixed(2)}, ${(y - it.y).toFixed(2)})`;
    }
  }

  // ---------- hover and drag, moved along once per frame ----------
  function updateGoo(c, r, dt) {
    const hw = r.width / 2, hh = r.height / 2, cx = r.left + hw, cy = r.top + hh;
    const rx = Math.max(-hw, Math.min(hw, ptr.x - cx)), ry = Math.max(-hh, Math.min(hh, ptr.y - cy));
    // Hover: nothing for the first few seconds, then the part of the edge nearest the mouse slowly follows it.
    c.dwell = c.engaged && !press ? c.dwell + dt : 0;
    const wantPlay = c.dwell > 2.5 && !rmq.matches && c.blow <= 0 ? 1 : 0;
    c.play += (wantPlay - c.play) * Math.min(1, dt * (wantPlay ? 0.4 : 0.6));
    if (!c.slow) c.slow = [rx, ry];
    if (c.engaged) { c.slow[0] += (rx - c.slow[0]) * Math.min(1, dt * 1.6); c.slow[1] += (ry - c.slow[1]) * Math.min(1, dt * 1.6); }
    const ox = c.slow[0] / hw, oy = c.slow[1] / hh, toEdge = Math.min(hw - Math.abs(c.slow[0]), hh - Math.abs(c.slow[1]));
    const edgeNear = Math.pow(Math.min(1, Math.hypot(ox, oy)), 2);
    const lim = (v) => Math.max(-120, Math.min(120, v)) * 0.3;
    const vx = c.engaged ? lim(rx - c.slow[0]) : 0, vy = c.engaged ? lim(ry - c.slow[1]) : 0;
    c.hoverAt = c.slow;
    c.hoverD = [c.play * (ox * T.hoverpull * edgeNear + vx), c.play * (oy * T.hoverpull * edgeNear + vy)];
    c.hoverR = c.play > 0.001 ? Math.max(130, toEdge + 70, Math.hypot(c.hoverD[0], c.hoverD[1]) * 1.25) : 0;

    // Drag: each held spot follows the mouse slowly, like pulling something thick, then slowly relaxes.
    for (const p of c.pulls) {
      if (p.held) {
        let tx = (ptr.x - cx - p.ax) * T.dragpull, ty = (ptr.y - cy - p.ay) * T.dragpull;
        const m = Math.hypot(tx, ty);
        if (m > 0.01) { const soft = 200 * Math.tanh(m / 200) / m; tx *= soft; ty *= soft; }
        p.vx += ((tx - p.dx) * 7 - p.vx * 4.5) * dt;
        p.vy += ((ty - p.dy) * 7 - p.vy * 4.5) * dt;
      } else {
        const keep = Math.exp(-dt * (p.fast ? 1.2 : 1 / T.memory));
        p.dx *= keep; p.dy *= keep;
        const damp = Math.exp(-dt * 4.5);
        p.vx *= damp; p.vy *= damp;
      }
      p.dx += p.vx * dt; p.dy += p.vy * dt;
    }
    c.pulls = c.pulls.filter((p) => p.held || Math.hypot(p.dx, p.dy) + Math.hypot(p.vx, p.vy) > 0.3);
  }

  // ---------- loop ----------
  const bgLights = new Float32Array(8), palBuf = new Float32Array(9);
  const splashBuf = new Float32Array(32), splashColBuf = new Float32Array(24);
  let t = 0, last = performance.now();
  // Cards currently lifted above the others. Each engagement adds a new layer that fades in on top, so
  // the stacking order never visibly jumps; a layer fades away after its card is let go.
  let layers = [];
  const bumpBuf = new Float32Array(32), bumpR = new Float32Array(8);
  function drawOrb(c, r, fade, glow) {
    const hw = r.width / 2, hh = r.height / 2;
    gl.bindTexture(gl.TEXTURE_2D, c.hasVid ? c.vid.tex : blank);
    for (let j = 0; j < 3; j++) palBuf.set(c.pal[j], j * 3);
    const active = c.blow > 0 || c.pulls.length > 0;
    const margin = active ? MARGIN_ACTIVE : MARGIN;
    gl.uniform1f(ORB.u.uMargin, margin);
    gl.uniform4f(ORB.u.uBox, r.left + hw, r.top + hh, hw + margin, hh + margin);
    gl.uniform4f(ORB.u.uRect, r.left + hw, r.top + hh, hw, hh);
    const mid = Math.sin(Math.PI * c.blow);
    gl.uniform4f(ORB.u.uMeta, Math.min(T.radius + 170 * mid, hw, hh), c.hover, c.seed, c.hasVid ? Math.max(0.001, T.video) : 0);
    gl.uniform3fv(ORB.u.uPal, palBuf);
    gl.uniform1f(ORB.u.uVidAspect, c.hasVid ? c.vid.aspect : 1);
    gl.uniform1f(ORB.u.uFade, fade);
    gl.uniform1f(ORB.u.uFlex, (rmq.matches ? T.flex * 0.4 : T.flex * (1 + 5 * mid)));
    bumpBuf.fill(0); bumpR.fill(0);
    bumpBuf.set([c.hoverAt[0], c.hoverAt[1], c.hoverD[0], c.hoverD[1]], 0); bumpR[0] = c.hoverR;
    c.pulls.forEach((p, i) => {
      bumpBuf.set([p.ax, p.ay, p.dx, p.dy], (i + 1) * 4);
      bumpR[i + 1] = pullRadius(p);
    });
    // Mid-balloon, three big lumps push out around the edge, then settle back as it fills the screen.
    if (c.blow > 0 && !rmq.matches) {
      const size = Math.min(innerWidth, innerHeight), push = 0.3 * size * Math.pow(mid, 1.5);
      c.burstAngle.forEach((a, i) => {
        const dx = Math.cos(a), dy = Math.sin(a), k = [1, 0.7, 0.85][i];
        bumpBuf.set([dx * hw * 0.8, dy * hh * 0.8, dx * push * k, dy * push * k], (5 + i) * 4);
        bumpR[5 + i] = 0.48 * size * k;
      });
    }
    gl.uniform4fv(ORB.u.uBump, bumpBuf);
    gl.uniform1fv(ORB.u.uBumpR, bumpR);
    gl.uniform1f(ORB.u.uGlow, glow);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    t += dt * (rmq.matches ? 0.15 : 1) * T.drift * T.pace;
    resize();
    ptr.presence += ((ptr.inside ? 1 : 0) - ptr.presence) * Math.min(1, dt * 0.8);
    // The orbs follow a slow copy of the pointer, so they drift toward it rather than snap.
    if (ptr.slowX === undefined || ptr.slowX < -5000) { ptr.slowX = ptr.x; ptr.slowY = ptr.y; }
    ptr.slowX += (ptr.x - ptr.slowX) * Math.min(1, dt * 0.9);
    ptr.slowY += (ptr.y - ptr.slowY) * Math.min(1, dt * 0.9);
    const vw = innerWidth, vh = innerHeight;

    // 1. background
    gl.disable(gl.BLEND);
    use(BG, fullBuf);
    for (let j = 0; j < 4; j++) {
      bgLights[j * 2] = 0.5 + 0.45 * Math.sin(t * (0.05 + 0.02 * j) + j * 1.9);
      bgLights[j * 2 + 1] = 0.35 + 0.35 * Math.cos(t * (0.04 + 0.015 * j) + j * 2.7);
    }
    gl.uniform2f(BG.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(BG.u.uDpr, dpr); gl.uniform1f(BG.u.uT, t);
    gl.uniform3fv(BG.u.uBase, BG_BASE); gl.uniform3fv(BG.u.uCol, BG_COLS); gl.uniform2fv(BG.u.uLight, bgLights);
    gl.uniform3f(BG.u.uCursor, ptr.x, ptr.y, ptr.presence);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. orbs
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    use(ORB, quadBuf);
    gl.uniform2f(ORB.u.uView, vw, vh);
    gl.uniform3f(ORB.u.uCursor, ptr.slowX, ptr.slowY, ptr.presence);
    gl.uniform1f(ORB.u.uT, t);
    gl.uniform1f(ORB.u.uSwell, rmq.matches ? T.swell * 0.3 : T.swell);
    gl.uniform1f(ORB.u.uReach, rmq.matches ? T.reach * 0.4 : T.reach);
    gl.uniform1f(ORB.u.uLean, T.lean);
    gl.uniform1f(ORB.u.uRim, T.rim);
    gl.uniform1i(ORB.u.uVid, 0);
    gl.activeTexture(gl.TEXTURE0);
    if (blownCard) {
      const c = blownCard;
      c.blow = clamp01(c.blow + dt / (rmq.matches ? 0.5 : c.blowT ? T.blowtime : T.blowtime * 0.8) * (c.blowT ? 1 : -1));
      placeContent(c, vw, vh);
      if (c.blow <= 0 && !c.blowT) { c.el.classList.remove('is-blown'); blownCard = null; }
    }
    for (const c of cards) {
      const r = c.blow > 0 ? blowRect(c, vw, vh) : c.el.getBoundingClientRect();
      const over = !blownCard && !(press && press.card !== c) && ptr.inside && ptr.x > r.left - 20 && ptr.x < r.right + 20 && ptr.y > r.top - 20 && ptr.y < r.bottom + 20;
      const engaged = over || c === blownCard || (press && press.card === c) || (!blownCard && c.el.matches(':focus-within'));
      if (engaged && !c.engaged) layers.push({ c, a: 0 });
      c.engaged = engaged;
      // Builds over a few seconds and lets go even more slowly.
      c.hover += ((engaged ? 1 : 0) - c.hover) * Math.min(1, dt * (engaged ? 0.45 : 0.3));
      // The text follows more slowly than the orb, both coming in and letting go.
      c.text += ((engaged ? 1 : 0) - c.text) * Math.min(1, dt * (engaged ? 0.3 : 0.2));
      const textCss = (1 + (T.textmove - 1) * c.text).toFixed(3) + ' ' + (1 + T.textgrow / 100 * c.text).toFixed(4);
      if (textCss !== c.textCss) {
        c.textCss = textCss;
        const [a, s] = textCss.split(' ');
        c.el.style.setProperty('--a', a);
        c.el.style.setProperty('--s', s);
      }
      updateGoo(c, r, dt);
      if (r.bottom > -MARGIN_ACTIVE && r.top < vh + MARGIN_ACTIVE) bendContents(c);
      c.rect = r;
      c.onScreen = !(r.bottom < -MARGIN_ACTIVE || r.top > vh + MARGIN_ACTIVE);
      if (!c.onScreen) continue;
      // Once a card fills the screen, nothing else needs drawing.
      if (blownCard && blownCard.blow >= 1 && c !== blownCard) continue;
      c.hasVid = !!c.vid && uploadVideo(c);
      if (c.blow < 1) drawOrb(c, r, 1, T.glow);
    }
    // Lifted cards, oldest first. Only the newest layer for a card still being engaged keeps rising.
    layers = layers.filter((l, i) => {
      const live = l.c.engaged && !layers.slice(i + 1).some((m) => m.c === l.c);
      l.a = Math.max(0, Math.min(1, l.a + dt * (live ? 1.1 : -0.35)));
      return live || l.a > 0;
    });
    for (const l of layers) if (l.a > 0 && l.c.onScreen && l.c.blow <= 0 && !(blownCard && blownCard.blow >= 1)) drawOrb(l.c, l.c.rect, l.a, T.glow * 0.5);
    if (blownCard) drawOrb(blownCard, blownCard.rect, blownCard.blow < 1 ? clamp01(blownCard.blow * 14) : 1, T.glow * 0.5);

    // 3. splashes
    let any = false;
    for (let k = 0; k < 8; k++) {
      const sp = splashes[k];
      const age = sp ? (now - sp.t0) / 2400 : 1;
      if (age < 1) any = true;
      splashBuf.set(sp ? [sp.x - scrollX, sp.y - scrollY, Math.min(1, age), sp.r] : [0, 0, 1, 0], k * 4);
      if (sp) splashColBuf.set(sp.col, k * 3);
    }
    if (any) {
      use(SPL, fullBuf);
      gl.uniform2f(SPL.u.uRes, canvas.width, canvas.height);
      gl.uniform1f(SPL.u.uDpr, dpr);
      gl.uniform4fv(SPL.u.uSplash, splashBuf);
      gl.uniform3fv(SPL.u.uSplashCol, splashColBuf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
  }

  // ---------- text drift timing: every element on its own slow clock ----------
  const rand = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  document.querySelectorAll('.orb h2, .orb h3, .orb .quote').forEach((el, i) => {
    el.style.setProperty('--dur', (38 + rand(i, 1) * 26).toFixed(1) + 's');
    el.style.setProperty('--del', (-rand(i, 2) * 60).toFixed(1) + 's');
  });
  document.querySelectorAll('.cta, .tags span, .quote-nav button, .pills a, .pills button').forEach((el, i) => {
    el.style.setProperty('--swing', (5.5 + rand(i, 3) * 4.5).toFixed(2) + 's');
    el.style.setProperty('--sdel', (-rand(i, 4) * 10).toFixed(2) + 's');
  });

  // ---------- testimonials ----------
  const QUOTES = [
    ['Dan’s grasp of web development and trends has really allowed us to push the envelope.', 'Zach Kahn, CTO + Product Manager, BI Worldwide'],
    ['Dan’s design, thinking and responsiveness is great.', 'Hugh MacNiven, Director of Learning Strategy, BI Worldwide'],
    ['Let me know if you ever need a reference… or if you’re interviewing, I’ll go with you to the interview.', 'Rich Hultman, Senior Innovation Designer and UX Strategist, IBM Watson + Best Buy alum'],
    ['Dan is one of the most detailed designers I’ve seen. He is instrumental to our product.', 'Robert Plummer, ML Engineer (Stealth AI Startup)'],
    ['Creative and insightful. Dan is the man! Highly recommended!', 'Andy Kovan, Brand + Creative Director, The Brandon Agency'],
    ['Dan is always thinking outside the box and bringing fresh, creative ideas.', 'Clive Vang, UI/UX Designer, Truist'],
  ];
  let qi = 0;
  const quoteEl = document.getElementById('quote'), whoEl = document.getElementById('who');
  function showQuote(i) {
    qi = (i + QUOTES.length) % QUOTES.length;
    quoteEl.style.opacity = whoEl.style.opacity = 0;
    setTimeout(() => { setWords(quoteEl, '“' + QUOTES[qi][0] + '”'); setWords(whoEl, QUOTES[qi][1]); remeasure(); quoteEl.style.opacity = whoEl.style.opacity = ''; }, 250);
  }
  document.getElementById('q-next').addEventListener('click', () => showQuote(qi + 1));
  document.getElementById('q-prev').addEventListener('click', () => showQuote(qi - 1));
  setWords(quoteEl, '“' + QUOTES[0][0] + '”'); setWords(whoEl, QUOTES[0][1]);
  if (!rmq.matches) setInterval(() => showQuote(qi + 1), 7000);

  document.getElementById('copy-email').addEventListener('click', (e) => {
    navigator.clipboard?.writeText('benner.dan@gmail.com').then(() => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'benner.dan@gmail.com · Copy'), 1600); });
  });

  // ---------- tune panel ----------
  const tune = document.getElementById('tune'), tuneBtn = document.getElementById('tune-btn');
  const inputs = [...tune.querySelectorAll('[data-k]')];
  const fmt = (k, v) => (k === 'textgrow' ? v + ' %' : k === 'textmove' || k === 'dragpull' ? (+v).toFixed(1) + '×' : k === 'memory' || k === 'blowtime' ? (+v).toFixed(1) + ' s' : ['hoverpull', 'flex', 'swell', 'reach', 'space', 'radius', 'lean'].includes(k) ? v + ' px' : (+v).toFixed(2));
  function syncTune() { inputs.forEach((i) => { i.value = T[i.dataset.k]; document.getElementById('o-' + i.dataset.k).textContent = fmt(i.dataset.k, T[i.dataset.k]); }); document.documentElement.style.setProperty('--gap', T.space + 'px'); save(); }
  inputs.forEach((i) => i.addEventListener('input', () => { T[i.dataset.k] = parseFloat(i.value); syncTune(); }));
  tuneBtn.addEventListener('click', () => { tune.hidden = !tune.hidden; tuneBtn.setAttribute('aria-expanded', String(!tune.hidden)); });
  document.getElementById('t-reset').addEventListener('click', () => { Object.assign(T, DEFAULTS); syncTune(); });
  document.getElementById('t-copy').addEventListener('click', (e) => navigator.clipboard?.writeText(JSON.stringify(T, null, 2)).then(() => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy settings'), 1500); }));
  syncTune();

  requestAnimationFrame((n) => { last = n; frame(n); });
  window.__orbHome = { T, cards };
})();
