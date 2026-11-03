// Orb Home renderer. Three passes per frame:
//   1. background: the homepage grey with pastel lights drifting through it
//   2. one pass per visible card: a loose, flexing orb in the card's colors, or its video, drawn
//      on a quad that extends well past the card so lobes can bleed into neighboring areas
//   3. click splashes over everything
(() => {
  const DEFAULTS = { flex: 10, swell: 60, pace: 0.45, radius: 30, lean: 70, glow: 0.8, rim: 0.5, drift: 1, splash: 1, video: 0.85 };
  const T = Object.assign({}, DEFAULTS);
  try { const s = JSON.parse(localStorage.getItem('orb-home:v3') || 'null'); if (s) for (const k in DEFAULTS) if (typeof s[k] === 'number') T[k] = s[k]; } catch (e) {}
  const save = () => { try { localStorage.setItem('orb-home:v3', JSON.stringify(T)); } catch (e) {} };
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
  const MARGIN = 200;
  const ORB = program(`
    attribute vec2 a; uniform vec4 uBox; uniform vec2 uView; varying vec2 vP;
    void main() {
      vP = uBox.xy + a * uBox.zw;
      gl_Position = vec4(vP.x / uView.x * 2.0 - 1.0, 1.0 - vP.y / uView.y * 2.0, 0.0, 1.0);
    }`, COMMON + `
    varying vec2 vP;
    uniform vec4 uRect;              // center, half size (CSS px, y down)
    uniform vec4 uMeta;              // corner radius, hover, seed, video strength (0 = none)
    uniform vec3 uPal[3];            // dominant, accent, accent
    uniform vec3 uCursor;
    uniform float uT, uFlex, uSwell, uLean, uGlow, uRim, uVidAspect;
    uniform sampler2D uVid;

    float sdRoundBox(vec2 q, vec2 b, float r) { vec2 d = abs(q) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
    float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

    void main() {
      vec2 q = vP - uRect.xy;
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

      // Hover: the orb slowly reaches toward the pointer.
      vec2 cq = uCursor.xy - uRect.xy;
      vec2 dq = q - cq;
      float near = exp(-dot(dq, dq) / (2.0 * 240.0 * 240.0));
      d -= uLean * hov * (0.35 + 0.65 * near);

      float inside = 1.0 - smoothstep(-3.0, 3.0, d);

      // Inside color: the dominant color fills the body; two accents drift through it as smaller pools.
      vec3 ic = uPal[0]; 
      for (int j = 1; j < 3; j++) {
        float fj = float(j);
        vec2 L = vec2(sin(t * (0.19 + 0.05 * fj) + s + fj * 1.7), cos(t * (0.15 + 0.06 * fj) + s * 1.3 + fj * 2.1)) * hs * 0.75;
        float pool = exp(-dot(q - L, q - L) / (2.0 * pow(m * 0.55, 2.0)));
        ic = mix(ic, uPal[j], pool * 0.8);
      }

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
      }

      body *= (0.88 + 0.12 * smoothstep(-70.0, 0.0, d)) * (1.0 + 0.22 * hov * near);
      float rim = exp(-pow(min(d, 0.0) / 13.0, 2.0)) * inside;
      body += ic * rim * uRim * 0.6 + vec3(rim * uRim * 0.07);

      // Outside: a soft glow in the card's colors and a faint shadow below.
      float halo = exp(-max(d, 0.0) / 26.0) * uGlow * (0.45 + 0.55 * hov) * (1.0 - inside) * 0.55;
      float ds = sdRoundBox(q - vec2(0.0, 14.0), hs, uMeta.x);
      float shade = 0.08 * exp(-max(ds, 0.0) / 28.0) * (1.0 - inside) * (1.0 - halo);

      // Fade the quad's own border so the margin never shows as a hard edge.
      vec2 boxH = hs + ${MARGIN.toFixed(1)};
      float border = smoothstep(0.0, 40.0, min(boxH.x - abs(q.x), boxH.y - abs(q.y)));

      vec3 outRgb = toGamma(body) * inside + toGamma(ic) * halo;
      float outA = max(inside, halo + shade);
      gl_FragColor = vec4(outRgb, outA) * border;
    }`, ['uBox', 'uView', 'uRect', 'uMeta', 'uPal', 'uCursor', 'uT', 'uFlex', 'uSwell', 'uLean', 'uGlow', 'uRim', 'uVidAspect', 'uVid']);

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

  // Three colors per card: the first listed color is dominant, plus the two others that differ most from it.
  function threeColors(hexes) {
    const rgb = hexes.map(hexToRgb), dom = rgb[0];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const rest = hexes.slice(1).map((h, i) => ({ h, d: dist(rgb[i + 1], dom) })).sort((a, b) => b.d - a.d);
    return [hexes[0], rest[0].h, (rest[1] || rest[0]).h];
  }
  const sampler = document.createElement('canvas');
  sampler.width = 16; sampler.height = 9;
  const sctx = sampler.getContext('2d', { willReadFrequently: true });

  const cards = [...document.querySelectorAll('.orb')].map((el, i) => {
    const hex = threeColors(el.dataset.pal.split(',').map((h) => h.trim()));
    const c = { el, hex, pal: hex.map((h) => toLin(hexToRgb(h))), seed: (i * 0.6180339) % 1, hover: 0, splashTurn: 0, vid: null, lastSample: 0 };
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
      // Every half second, the video's average color becomes this card's dominant color (eased).
      const now = performance.now();
      if (now - c.lastSample > 500) {
        c.lastSample = now;
        sctx.drawImage(V.v, 0, 0, 16, 9);
        const px = sctx.getImageData(0, 0, 16, 9).data;
        let rr = 0, gg = 0, bb = 0;
        for (let k = 0; k < px.length; k += 4) { rr += px[k]; gg += px[k + 1]; bb += px[k + 2]; }
        const n = px.length / 4;
        c.vidDom = toLin([rr / n / 255, gg / n / 255, bb / n / 255]);
      }
      if (c.vidDom) c.pal[0] = c.pal[0].map((v, k) => v + (c.vidDom[k] - v) * 0.04);
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
  addEventListener('pointermove', (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => (ptr.inside = false));
  const splashes = new Array(8).fill(null);
  let splashNext = 0, bgTurn = 0;
  addEventListener('pointerdown', (e) => {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true;
    if (e.target.closest('a, button, input, .tune')) return;
    const card = cards.find((c) => c.el.contains(e.target));
    const hex = card ? card.hex[1 + (card.splashTurn++ % 2)] : BG_HEX[bgTurn++ % BG_HEX.length];
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    const col = toLin(hslToRgb([h + (card ? 0.33 : 0), Math.min(1, s * 1.15 + 0.15), Math.min(0.7, Math.max(0.35, l))]));
    splashes[splashNext] = { x: e.pageX, y: e.pageY, t0: performance.now(), col, r: (card ? 170 : 240) * T.splash };
    splashNext = (splashNext + 1) % splashes.length;
  });

  // ---------- loop ----------
  const bgLights = new Float32Array(8), palBuf = new Float32Array(9);
  const splashBuf = new Float32Array(32), splashColBuf = new Float32Array(24);
  let t = 0, last = performance.now();
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
    gl.uniform1f(ORB.u.uFlex, rmq.matches ? T.flex * 0.4 : T.flex);
    gl.uniform1f(ORB.u.uSwell, rmq.matches ? T.swell * 0.3 : T.swell);
    gl.uniform1f(ORB.u.uLean, T.lean);
    gl.uniform1f(ORB.u.uGlow, T.glow);
    gl.uniform1f(ORB.u.uRim, T.rim);
    gl.uniform1i(ORB.u.uVid, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const c of cards) {
      const r = c.el.getBoundingClientRect();
      const over = ptr.inside && ptr.x > r.left - 20 && ptr.x < r.right + 20 && ptr.y > r.top - 20 && ptr.y < r.bottom + 20;
      // Builds over a few seconds and lets go even more slowly.
      c.hover += ((over ? 1 : 0) - c.hover) * Math.min(1, dt * (over ? 0.45 : 0.3));
      if (r.bottom < -MARGIN || r.top > vh + MARGIN) continue;
      const hw = r.width / 2, hh = r.height / 2;
      const hasVid = c.vid && uploadVideo(c);
      if (!hasVid) gl.bindTexture(gl.TEXTURE_2D, blank);
      for (let j = 0; j < 3; j++) palBuf.set(c.pal[j], j * 3);
      gl.uniform4f(ORB.u.uBox, r.left + hw, r.top + hh, hw + MARGIN, hh + MARGIN);
      gl.uniform4f(ORB.u.uRect, r.left + hw, r.top + hh, hw, hh);
      gl.uniform4f(ORB.u.uMeta, Math.min(T.radius, hw, hh), c.hover, c.seed, hasVid ? Math.max(0.001, T.video) : 0);
      gl.uniform3fv(ORB.u.uPal, palBuf);
      gl.uniform1f(ORB.u.uVidAspect, hasVid ? c.vid.aspect : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

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
    setTimeout(() => { quoteEl.textContent = '“' + QUOTES[qi][0] + '”'; whoEl.textContent = QUOTES[qi][1]; quoteEl.style.opacity = whoEl.style.opacity = ''; }, 250);
  }
  document.getElementById('q-next').addEventListener('click', () => showQuote(qi + 1));
  document.getElementById('q-prev').addEventListener('click', () => showQuote(qi - 1));
  quoteEl.textContent = '“' + QUOTES[0][0] + '”'; whoEl.textContent = QUOTES[0][1];
  if (!rmq.matches) setInterval(() => showQuote(qi + 1), 7000);

  document.getElementById('copy-email').addEventListener('click', (e) => {
    navigator.clipboard?.writeText('benner.dan@gmail.com').then(() => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'benner.dan@gmail.com · Copy'), 1600); });
  });

  // ---------- tune panel ----------
  const tune = document.getElementById('tune'), tuneBtn = document.getElementById('tune-btn');
  const inputs = [...tune.querySelectorAll('[data-k]')];
  const fmt = (k, v) => (['flex', 'swell', 'radius', 'lean'].includes(k) ? v + ' px' : (+v).toFixed(2));
  function syncTune() { inputs.forEach((i) => { i.value = T[i.dataset.k]; document.getElementById('o-' + i.dataset.k).textContent = fmt(i.dataset.k, T[i.dataset.k]); }); save(); }
  inputs.forEach((i) => i.addEventListener('input', () => { T[i.dataset.k] = parseFloat(i.value); syncTune(); }));
  tuneBtn.addEventListener('click', () => { tune.hidden = !tune.hidden; tuneBtn.setAttribute('aria-expanded', String(!tune.hidden)); });
  document.getElementById('t-reset').addEventListener('click', () => { Object.assign(T, DEFAULTS); syncTune(); });
  document.getElementById('t-copy').addEventListener('click', (e) => navigator.clipboard?.writeText(JSON.stringify(T, null, 2)).then(() => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy settings'), 1500); }));
  syncTune();

  requestAnimationFrame((n) => { last = n; frame(n); });
  window.__orbHome = { T, cards };
})();
