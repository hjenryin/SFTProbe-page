// Fig. 2(a) -> Fig. 3(b) -> Fig. 3(a) walkthrough. Every frame is drawn from the
// measured data in morph_data.js; tweens only move the camera, fade layers, or
// reveal measured values. Steps 1-2 and 7 are a 3D Plotly scene (#plot); steps 3-6
// are a 2D Plotly plot (#plot2d) stacked on top and crossfaded in. At the handoff the
// 2D plot area is placed exactly over the projected 3D axis box (see calibrate()).
(async function () {
  "use strict";
  await document.fonts.ready;
  const PLOT_FONT = getComputedStyle(document.body).fontFamily;
  const D = window.MORPH_DATA;
  const M = D.mesh;
  const S = D.slice;
  const C = D.colors;
  const [LOSS_MIN, LOSS_MAX] = D.loss_range;
  const FLOOR = LOSS_MIN - 0.5;
  const Z_TOP = LOSS_MAX + 0.5;
  const N_DIFF = S.difficulty.length;
  const NX = S.x.length;
  const RESIDUE = S.difficulty.map((row) => row.map((v, k) => v - S.difficulty[0][k]));
  const RES_MIN = Math.min(...RESIDUE.flat());
  const RES_MAX = Math.max(...RESIDUE.flat());
  const PAD = 0.08 * (RES_MAX - RES_MIN);
  const MEAN_AT_ORIGIN = interp(0, S.x, S.mean);
  const X_RANGE = [D.xy_range[0], D.xy_range[1]];
  const PAPER_EYE = { x: 1.8, y: 1.1, z: 0.95 }; // camera used for Fig. 2(a)
  const EYE_R = Math.hypot(PAPER_EYE.x, PAPER_EYE.y, PAPER_EYE.z);
  // Side views can fill more of the viewport than the full 3D basin. The same
  // responsive zoom is used when measuring the 2D/3D handoff.
  function framingZoom(el) {
    const narrow = gd.clientWidth < 600;
    return lerp(narrow ? 1.0 : 1.35, narrow ? 1.8 : 2.3, clamp((20 - el) / 20, 0, 1));
  }
  // Turntable drag keeps camera.up = +z, so the top view sits just short of 90 deg
  // to keep up and the view direction from being parallel.
  const TOP_EL = 89.5;
  const SIDE = { el: 0, az: -90, zasp: 0.7 }; // the 3D pose at both 2D/3D handoffs
  const Z_UP = [0, 0, 1];
  // Inflection style from the paper: black solid underlay under a dashed yellow line.
  const INF_W = C.inflection_width;             // 1.5
  const INF_UNDER_W = C.inflection_under_width; // 3.5
  const INF_DASH_PX = C.inflection_dash.map((v) => v + "px").join(","); // "7.5px,4.5px"
  const CROSS_UNDER_ALPHA = 0.35; // Fig. 3(b) vertical lines; the Fig. 3(a) ring uses 1

  // ---------------------------------------------------------------- states
  // One flat parameter set covers both plots; transitions tween every field.
  // Shared: ov (0 = 3D plot shown, 1 = 2D plot shown), cross (inflection lines on the cut),
  //   cbL/cbC (loss / correlation colorbar opacity).
  // 3D:  h surface height (0 = flat), c 0 viridis(loss) -> 1 coolwarm(corr) surface colors,
  //   el/az camera (deg), zasp z aspect, surf/cont/ring opacities, slice (black mean line),
  //   cline (correlation-colored mean line), loff (small lift of the lines above the surface).
  // 2D:  split mean -> five difficulty curves, sub subtract difficulty-1 loss, zoom y range
  //   to residue scale, band sweep of the correlation bands (left -> right), conc bands
  //   shrink onto the mean line, ccol the single correlation-colored loss line replacing the black/difficulty curves.
  const S1 = { ov: 0, cross: 0, cbL: 1, cbC: 0,
               h: 1, c: 0, el: elev(PAPER_EYE), az: azim(PAPER_EYE), zasp: 0.88, surf: 0.9, cont: 0, ring: 1,
               slice: 0, cline: 0, loff: 1,
               split: 0, sub: 0, zoom: 0, band: 0, conc: 0, ccol: 0 };
  const GHOST = 0.2; // semitransparent surface while the view turns (steps 2 and 6 -> 7)
  const S2 = { ...S1, ...SIDE, surf: GHOST, slice: 1, cross: 1, ring: 0, cbL: 0 };
  const H2 = { ...S2, surf: 0, loff: 0 };                    // 3D side of the 2 -> 3 handoff
  const S3 = { ...H2, ov: 1, split: 1 };
  const S4 = { ...S3, sub: 1, zoom: 1 };
  const S5 = { ...S4, band: 1, cbC: 1 };                      // five residual curves on the bands
  const S6 = { ...S5, sub: 0, zoom: 0, split: 0, conc: 1, ccol: 1 };
  const H6 = { ...S6, c: 1, slice: 0, cline: 1 };            // 3D side of the 6 -> 7 handoff (hidden)
  // Final step: the real 3D basin (h = 1) seen from the top, so it can still be rotated.
  const G7 = { ...H6, ov: 0, el: TOP_EL, az: -90, zasp: 0.88, surf: GHOST, cross: 0, loff: 1 };
  const S7 = { ...G7, surf: 1, cont: 1, ring: 1, cline: 0 };
  const STATES = [S1, S2, S3, S4, S5, S6, S7];
  // FWD[i] is the list of segments for step i -> i + 1. A segment tweens the listed
  // parameters to `to` over `ms`; `win` gives a parameter its own [start, end]
  // fraction of the segment ("cam" = the whole camera). Going back plays the
  // segments in reverse with mirrored windows.
  const FWD = [
    [ // 1 -> 2: cut, turn to the side view; the ring fades as the crossing lines appear
      { to: S2, ms: 3000, win: { slice: [0, 0.22], cam: [0.2, 0.9], zasp: [0.2, 0.9], surf: [0.25, 0.75],
                                 cbL: [0.25, 0.6], cross: [0.75, 1], ring: [0.75, 1] } },
    ],
    [ // 2 -> 3: the landscape fades out, the 2D plot takes over, then the split
      { to: H2, ms: 1100, win: { cam: [0, 0.4], zasp: [0, 0.4], surf: [0, 0.6], loff: [0.55, 1] } },
      { to: { ...H2, ov: 1 }, ms: 450 },
      { to: S3, ms: 1400 },
    ],
    [ // 3 -> 4: subtract difficulty 1 and zoom (2D)
      { to: S4, ms: 2400 },
    ],
    [ // 4 -> 5: correlation bands sweep in behind the five curves
      { to: S5, ms: 2200, win: { cbC: [0, 0.5] } },
    ],
    [ // 5 -> 6: bands concentrate as the difficulty curves fade into the colored mean line
      { to: S6, ms: 3200, win: { sub: [0, 0.3], zoom: [0, 0.3], split: [0.25, 1], conc: [0.25, 1],
                                 ccol: [0.25, 1] } },
    ],
    [ // 6 -> 7: back to 3D with a semitransparent coolwarm basin, camera to the top view,
      // then the surface turns opaque as the contours and the ring come in
      { to: H6, ms: 0 },
      { to: G7, ms: 3400, win: { ov: [0, 0.15], surf: [0.05, 0.4], loff: [0.15, 0.3], cam: [0.3, 1],
                                 zasp: [0.3, 1], cross: [0.3, 0.55] } },
      { to: S7, ms: 1600, win: { surf: [0, 0.7], cont: [0.1, 0.8], ring: [0.1, 0.8], cline: [0.3, 1] } },
    ],
  ];
  const JUMP_SCALE = 0.45; // non-adjacent jumps play every step in between, faster

  // Segments for an adjacent step i -> j (|i - j| = 1).
  function stepPlan(i, j) {
    if (j > i) return FWD[i];
    const segs = FWD[j];
    const out = [];
    let before = STATES[j];
    const starts = segs.map((seg) => { const s = before; before = { ...before, ...seg.to }; return s; });
    for (let n = segs.length - 1; n >= 0; n--) {
      const win = {};
      for (const [key, w] of Object.entries(segs[n].win || {})) win[key] = [1 - w[1], 1 - w[0]];
      out.push({ to: starts[n], ms: segs[n].ms, win });
    }
    return out;
  }

  const CAPTIONS = [
    [
      "Random directions are sufficient for difficulty",
      "We evaluate the loss while perturbing the pretrained model along random parameter directions. Difficulty scoring does not require LoRA directions."
    ],
    [
      "The pretrained model lies in a loss basin",
      "Along a random direction, the pretrained model lies in a relatively flat, near-parabolic loss basin. The inflection points mark where the basin stops curving upward."
    ],
    [
      "Problems are classified by difficulty",
      "Problems with known difficulty labels are grouped into five levels, from 1 (easiest) to 5 (hardest). Comparing their losses tests whether loss can distinguish problem difficulty."
    ],
    [
      "Different problems have different curvature",
      "The difficulty groups have different curvature in their loss. Harder problems exhibit higher curvature, allowing perturbation to reveal difficulty differences that are obscured near the pretrained checkpoint."
    ],
    [
      "Separation depends on the perturbation scale",
      "Different perturbation magnitudes produce different separation between difficulty levels. A checkpoint chosen at an arbitrary scale may therefore give a poor difficulty score."
    ],
    [
      "Largest separation occurs near the inflection point",
      "Difficulty levels are best separated near the basin’s inflection point. Evaluating this loss at this checkpoint gives a loss-based score that increases with problem difficulty."
    ],
    [
      "The same pattern holds across random directions",
      "Difficulty levels separate best near the inflection boundary across random directions. We can therefore score difficulty using any random direction, with the perturbation scale set by its inflection point."
    ]
  ];

  // ---------------------------------------------------------------- helpers
  function interp(x0, xs, ys) {
    for (let k = 0; k < xs.length - 1; k++) {
      if (xs[k] <= x0 && x0 <= xs[k + 1]) {
        const t = (x0 - xs[k]) / (xs[k + 1] - xs[k]);
        return ys[k] + t * (ys[k + 1] - ys[k]);
      }
    }
    return NaN;
  }
  function elev(e) { return (Math.asin(e.z / Math.hypot(e.x, e.y, e.z)) * 180) / Math.PI; }
  function azim(e) { return (Math.atan2(e.y, e.x) * 180) / Math.PI; }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  const rgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  const mixRgb = (a, b, t) => [0, 1, 2].map((i) => lerp(a[i], b[i], t));
  const lift = (z, h) => FLOOR + h * (z - FLOOR);
  const norm3 = (v) => Math.hypot(v[0], v[1], v[2]);
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const xyz = (v) => ({ x: v[0], y: v[1], z: v[2] });
  const arr = (o) => [o.x, o.y, o.z];
  const r4 = (v) => Math.round(v * 1e4) / 1e4;

  // Quantization: ~40 levels per parameter, so redraws only happen when the
  // picture can actually change and cached arrays keep the same reference.
  const QN = 40;
  const q = (v) => Math.round(v * QN) / QN;
  const QZASP = 200; // aspect ratio changes force a full gl3d replot; keep them coarse but smooth

  // Small LRU memo: same key -> same object (Plotly.react skips arrays with the same reference).
  function memo(limit, build) {
    const cache = new Map();
    return function (key, ...args) {
      if (cache.has(key)) {
        const v = cache.get(key);
        cache.delete(key); cache.set(key, v);
        return v;
      }
      const v = build(...args);
      cache.set(key, v);
      if (cache.size > limit) cache.delete(cache.keys().next().value);
      return v;
    };
  }

  // ---------------------------------------------------------------- static geometry
  const contourXY = { x: [], y: [], level: [] };
  for (const path of D.contours) {
    for (const [px, py] of path.xy) {
      contourXY.x.push(px); contourXY.y.push(py); contourXY.level.push(path.level);
    }
    contourXY.x.push(NaN); contourXY.y.push(NaN); contourXY.level.push(NaN);
  }
  const ringX = D.ring.map((p) => p[0]);
  const ringY = D.ring.map((p) => p[1]);
  const ringL = D.ring.map((p) => p[2]);
  const ringOpen = ringX.length && (ringX[0] !== ringX[ringX.length - 1] || ringY[0] !== ringY[ringY.length - 1]);
  if (ringOpen) { ringX.push(ringX[0]); ringY.push(ringY[0]); ringL.push(ringL[0]); }
  const sliceY = S.x.map(() => 0);
  const DIFF_RGB = C.difficulty.map(hexToRgb);
  const MEAN_RGB = [34, 34, 34];
  const CORR_RGB = S.corr_rgb; // exact matplotlib coolwarm color of each slice point
  const ORIGIN_X = [0];
  const ORIGIN_Y = [0];
  const crossX = [], crossY = [], crossZ = [];
  for (const xc of S.ring_crossings) { crossX.push(xc, xc, NaN); crossY.push(0, 0, NaN); crossZ.push(FLOOR, Z_TOP, NaN); }
  // Line widths shared by the 3D and 2D plots so the handoff matches.
  const LINE_W = 4;        // mean / difficulty curves
  const CLINE_W = 4;       // correlation-colored line
  const CLINE_UNDER_W = 7; // its black outline

  // The correlation-colored line: each slice point owns the half-segments on either
  // side of it and is drawn in that point's own color (no blended colors).
  const mid = (a, b) => 0.5 * (a + b);
  const halfSeg = [];      // per point: { x: [...], y: [...] } for the 2D segment traces
  const cl3X = [], cl3M = [], cl3Col = []; // the same polyline for 3D, colors per vertex
  for (let k = 0; k < NX; k++) {
    const xs = [], ms = [];
    if (k > 0) { xs.push(mid(S.x[k - 1], S.x[k])); ms.push(mid(S.mean[k - 1], S.mean[k])); }
    xs.push(S.x[k]); ms.push(S.mean[k]);
    if (k < NX - 1) { xs.push(mid(S.x[k], S.x[k + 1])); ms.push(mid(S.mean[k], S.mean[k + 1])); }
    halfSeg.push({ x: xs, y: ms });
    const col = rgb(CORR_RGB[k]);
    for (let n = 0; n < xs.length; n++) { cl3X.push(xs[n]); cl3M.push(ms[n]); cl3Col.push(col); }
  }
  const cl3Y = cl3X.map(() => 0);
  // Background bands for the 2D correlation sweep: one per slice point, edges at midpoints.
  const bandEdges = S.x.map((x, k) => [k > 0 ? mid(S.x[k - 1], x) : X_RANGE[0],
                                       k < NX - 1 ? mid(x, S.x[k + 1]) : X_RANGE[1]]);
  const BAND_ALPHA = 0.3; // full-height bands; they reach alpha 1 as they shrink onto the line

  // ---------------------------------------------------------------- 3D traces
  // Each builder is memoized on the quantized parameters it depends on, so a trace whose
  // inputs did not change is passed to Plotly.react as the same object (no recompute).
  const zOffAt = (h) => 0.06 * (LOSS_MAX - LOSS_MIN) * (1 - h) + 0.15;
  const LIGHT = { ambient: 1, diffuse: 0, specular: 0, roughness: 1, fresnel: 0 };

  const meshZ = memo(6, (h) => M.z.map((z) => lift(z, h)));
  const meshColor = memo(6, (c) => M.color_loss.map((a, n) => rgb(mixRgb(a, M.color_corr[n], c))));
  const meshTrace = memo(6, (h, c, op) => ({
    type: "mesh3d", uid: "surface", name: "surface", x: M.x, y: M.y, z: meshZ(String(h), h),
    i: M.i, j: M.j, k: M.k, vertexcolor: meshColor(String(c), c),
    opacity: op, visible: op > 0, flatshading: false, lighting: LIGHT, hoverinfo: "skip", showlegend: false,
  }));
  // While the surface is hidden, keep its last arrays so nothing is rebuilt.
  let meshArgs = [S1.h, S1.c];
  function surfaceTrace(p) {
    const shown = p.surf > 0.01;
    if (shown) meshArgs = [p.h, p.c];
    const [h, c] = meshArgs;
    const op = shown ? p.surf : 0;
    return meshTrace(`${h}|${c}|${op}`, h, c, op);
  }

  const contourZ = memo(4, (h) => { const o = zOffAt(h); return contourXY.level.map((l) => lift(l, h) + o); });
  const contourTrace = memo(4, (h, op) => ({
    type: "scatter3d", uid: "contours", name: "contours", mode: "lines",
    x: contourXY.x, y: contourXY.y, z: contourZ(String(h), h),
    line: { color: "black", width: 2 }, opacity: 0.75 * op, visible: op > 0.01,
    hoverinfo: "skip", showlegend: false,
  }));
  const ringZ = memo(4, (h) => { const o = zOffAt(h) + 0.05; return ringL.map((l) => lift(l, h) + o); });
  const ringZTop = memo(4, (h) => ringZ(String(h), h).map((z) => z + 0.02));
  // Fig. 3(a) ring: black solid underlay (full alpha) under the dashed yellow line.
  const ringTraces = memo(4, (h, op) => [
    { type: "scatter3d", uid: "ring-under", name: "ring-under", mode: "lines", x: ringX, y: ringY,
      z: ringZ(String(h), h), line: { color: "black", width: INF_UNDER_W }, opacity: op, visible: op > 0.01,
      hoverinfo: "skip", showlegend: false },
    { type: "scatter3d", uid: "ring", name: "Inflection Point", mode: "lines", x: ringX, y: ringY,
      z: ringZTop(String(h), h), line: { color: C.ring, width: INF_W, dash: "dash" }, opacity: op,
      visible: op > 0.01, hoverinfo: "skip", showlegend: false },
  ]);

  // Lines on the cut sit loff * zOffAt(h) above the surface (0 at the 2D handoffs).
  const meanZ3 = memo(6, (h, loff) => { const o = loff * zOffAt(h); return S.mean.map((m) => lift(m, h) + o); });
  const meanTrace3 = memo(6, (h, loff, op) => ({
    type: "scatter3d", uid: "mean3", name: "Mean loss", mode: "lines", x: S.x, y: sliceY,
    z: meanZ3(`${h}|${loff}`, h, loff), line: { color: rgb(MEAN_RGB), width: LINE_W },
    opacity: op, visible: op > 0.01, showlegend: false,
    hovertemplate: "Dir 1 = %{x:.3f}<br>%{z:.3f}<extra>Mean loss</extra>",
  }));
  const clineZ3 = memo(6, (h, loff) => { const o = loff * zOffAt(h); return cl3M.map((m) => lift(m, h) + o); });
  const clineTraces3 = memo(6, (h, loff, op) => {
    const z = clineZ3(`${h}|${loff}`, h, loff);
    return [
      { type: "scatter3d", uid: "cline3-under", name: "cline-under", mode: "lines", x: cl3X, y: cl3Y, z,
        line: { color: "black", width: CLINE_UNDER_W }, opacity: op, visible: op > 0.01,
        hoverinfo: "skip", showlegend: false },
      { type: "scatter3d", uid: "cline3", name: "Mean loss, colored by correlation", mode: "lines",
        x: cl3X, y: cl3Y, z, line: { color: cl3Col, width: CLINE_W }, opacity: op, visible: op > 0.01,
        hoverinfo: "skip", showlegend: false },
    ];
  });
  // Fig. 3(b) crossing lines: black underlay at alpha 0.35 under the dashed yellow line.
  const crossTraces3 = memo(4, (op) => [
    { type: "scatter3d", uid: "cross3-under", name: "cross-under", mode: "lines", x: crossX, y: crossY, z: crossZ,
      line: { color: "black", width: INF_UNDER_W }, opacity: CROSS_UNDER_ALPHA * op, visible: op > 0.01,
      hoverinfo: "skip", showlegend: false },
    { type: "scatter3d", uid: "cross3", name: "crossings", mode: "lines", x: crossX, y: crossY, z: crossZ,
      line: { color: C.ring, width: INF_W, dash: "dash" }, opacity: op, visible: op > 0.01,
      hoverinfo: "skip", showlegend: false },
  ]);
  const ORIGIN_MARKER = { symbol: "x", size: 5, color: C.origin, line: { width: 2, color: C.origin } };
  const originTrace3 = memo(6, (z) => ({
    type: "scatter3d", uid: "origin3", name: "origin", mode: "markers", x: ORIGIN_X, y: ORIGIN_Y, z: [z],
    marker: ORIGIN_MARKER, hoverinfo: "skip", showlegend: false,
  }));

  function traces3(p) {
    const oz = r4(lift(MEAN_AT_ORIGIN, p.h) + p.loff * (zOffAt(p.h) + 0.1));
    return [
      surfaceTrace(p),
      contourTrace(`${p.h}|${p.cont}`, p.h, p.cont),
      ...ringTraces(`${p.h}|${p.ring}`, p.h, p.ring),
      meanTrace3(`${p.h}|${p.loff}|${p.slice}`, p.h, p.loff, p.slice),
      ...clineTraces3(`${p.h}|${p.loff}|${p.cline}`, p.h, p.loff, p.cline),
      ...crossTraces3(String(p.cross), p.cross),
      originTrace3(String(oz), oz),
    ];
  }

  function layout3(p, view) {
    const axis = (title, range, opacity, titleOpacity = opacity) => ({
      title: { text: gd.clientWidth < 600 ? title.replace(" scale", "") : title,
        font: { size: gd.clientWidth < 600 ? 11 : 13, color: `rgba(70,81,101,${titleOpacity})` } },
      range, showticklabels: true, showgrid: true, gridcolor: `rgba(180,180,180,${0.45 * opacity})`,
      zeroline: false, showbackground: false, showspikes: false,
      tickfont: { size: 11, color: `rgba(70,81,101,${opacity})` },
    });
    const sideMix = clamp((20 - view.el) / 10, 0, 1);
    const topMix = clamp((view.el - 60) / 15, 0, 1);
    // Use screen-aligned annotations for the loss axis in every 3D pose.
    // Its title stays vertical and its ticks stay horizontal, matching 2D.
    // Pick the leftmost corner of the box; the side view uses the slice plane.
    const eye = view.camera.eye, center = view.camera.center;
    const lossX = eye.y >= center.y ? X_RANGE[1] : X_RANGE[0];
    const lossY = lerp(eye.x >= center.x ? D.xy_range[2] : D.xy_range[3], 0, sideMix);
    const xTitleMix = Math.max(sideMix, topMix);
    const tickUnit = 10 ** Math.floor(Math.log10((Z_TOP - FLOOR) / 5));
    const tickStep = [1, 2, 5, 10].find(n => n * tickUnit >= (Z_TOP - FLOOR) / 5) * tickUnit;
    const lossTicks = [];
    for (let z = Math.ceil(FLOOR / tickStep) * tickStep; z <= Z_TOP; z += tickStep) lossTicks.push(z);
    const lossAnnotations = lossTicks.map(z => ({
      x: lossX, y: lossY, z, text: String(z), showarrow: false,
      xanchor: "right", xshift: -8, opacity: 1 - topMix, font: { size: 11 },
    }));
    lossAnnotations.push({
      x: lossX, y: lossY, z: (FLOOR + Z_TOP) / 2,
      text: "Loss", showarrow: false, textangle: -90,
      xshift: -48, opacity: 1 - topMix, font: { size: 13 },
    });
    lossAnnotations.push({
      x: X_RANGE[0], y: 0, z: (FLOOR + Z_TOP) / 2,
      text: "Direction 2 scale", showarrow: false, textangle: -90,
      xshift: -48, opacity: topMix, font: { size: 13 },
    });
    return {
      font: { family: PLOT_FONT, size: 13, color: "#465165" },
      paper_bgcolor: "#fff",
      margin: { l: 45, r: 90, t: 8, b: 70 },
      showlegend: false,
      annotations: [
        { xref: "paper", yref: "paper", x: 0.5, y: -0.08,
          text: "Direction 1 scale", showarrow: false, yanchor: "top", opacity: xTitleMix, font: { size: 13 } },
      ],
      scene: {
        camera: view.camera,
        dragmode: "turntable",
        aspectmode: "manual",
        aspectratio: view.aspect,
        xaxis: { ...axis(xTitleMix < 0.999 ? "Direction 1 scale" : "", X_RANGE, 1, 1 - xTitleMix), tickvals: D.ticks },
        yaxis: { ...axis(topMix < 0.999 ? "Direction 2 scale" : "", [D.xy_range[2], D.xy_range[3]], 1 - sideMix, (1 - sideMix) * (1 - topMix)), tickvals: D.ticks },
        zaxis: {
          ...axis("", [FLOOR, Z_TOP], 1 - topMix),
          tickvals: lossTicks, tickmode: "array", showticklabels: false,
          ticktext: lossTicks.map(() => ""),
        },
        annotations: lossAnnotations,
      },
    };
  }

  // ---------------------------------------------------------------- 2D traces
  // y range: loss scale -> residue scale (Fig. 3(b)). At sub = zoom = 0 it equals the
  // 3D z range, so the 2D plot area can sit exactly on the projected 3D box.
  function yRange2(p) {
    return [lerp(FLOOR, RES_MIN - PAD, Math.max(p.sub, p.zoom)), lerp(Z_TOP, RES_MAX + PAD, p.zoom)];
  }
  // Curves: mean -> five difficulty levels -> minus difficulty 1. Fade out as the
  // correlation-colored line (which is the same mean curve) takes over.
  const curveY = memo(N_DIFF * 48, (d, split, sub) => S.x.map((_, k) =>
    lerp(S.mean[k], S.difficulty[d][k], split) - sub * S.difficulty[0][k]));
  const curveTrace2 = memo(N_DIFF * 48, (d, split, sub, op) => {
    const color = rgb(mixRgb(MEAN_RGB, DIFF_RGB[d], split));
    const label = C.difficulty_labels[d];
    const opacity = op * (d === 0 ? 1 : split);
    const shown = opacity > 0;
    return {
      type: "scatter", uid: "curve" + d, name: split > 0.5 ? label : "Mean loss",
      mode: "lines+markers", x: S.x, y: curveY(`${d}|${split}|${sub}`, d, split, sub),
      line: { color, width: LINE_W * lerp(1, 0.6, split) }, marker: { size: 5, color, opacity: split },
      opacity, visible: shown, showlegend: false,
      hovertemplate: "Dir 1 = %{x:.3f}<br>%{y:.3f}<extra>" + label + "</extra>", cliponaxis: true,
    };
  });
  // The single correlation-colored loss line (step 5): black outline + one short trace per point.
  const clineTraces2 = memo(4, (op) => {
    const shown = op > 0.01;
    const out = [{
      type: "scatter", uid: "cline2-under", name: "cline-under", mode: "lines", x: S.x, y: S.mean,
      line: { color: "black", width: CLINE_UNDER_W }, opacity: op, visible: shown, showlegend: false,
      customdata: S.corr, hovertemplate: "Dir 1 = %{x:.3f}<br>loss = %{y:.3f}<br>corr = %{customdata:.3f}<extra></extra>",
    }];
    halfSeg.forEach((seg, k) => out.push({
      type: "scatter", uid: "cline2-" + k, name: "cline", mode: "lines", x: seg.x, y: seg.y,
      line: { color: rgb(CORR_RGB[k]), width: CLINE_W }, opacity: op, visible: shown,
      hoverinfo: "skip", showlegend: false,
    }));
    return out;
  });
  const originTrace2 = memo(6, (y) => ({
    type: "scatter", uid: "origin2", name: "origin", mode: "markers", x: ORIGIN_X, y: [y],
    marker: { symbol: "x-thin", size: 9, color: C.origin, line: { width: 2.5, color: C.origin } },
    hoverinfo: "skip", showlegend: false, cliponaxis: false,
  }));

  function traces2(p) {
    const out = [];
    const curveOp = 1 - p.ccol;
    for (let d = 0; d < N_DIFF; d++) out.push(curveTrace2(`${d}|${p.split}|${p.sub}|${curveOp}`, d, p.split, p.sub, curveOp));
    out.push(...clineTraces2(String(p.ccol), p.ccol));
    const oy = r4(lerp(MEAN_AT_ORIGIN, S.origin_residue, p.sub));
    out.push(originTrace2(String(oy), oy));
    return out;
  }

  // Background correlation bands, revealed left to right; the front band is clipped.
  // conc 0 -> 1 shrinks each band vertically onto the mean line inside its own x span
  // (top and bottom edges move to the line) while its alpha rises to 1, so at conc = 1 the
  // bands have become the colored line. yr is the current 2D y range (data units).
  const meanAt = (x) => interp(clamp(x, S.x[0], S.x[NX - 1]), S.x, S.mean);
  const bandShapes = memo(4, (band, conc, yr) => {
    const out = [];
    if (band <= 0 || conc >= 0.999) return out;
    const alpha = r4(lerp(BAND_ALPHA, 1, conc));
    if (conc <= 0) {
      const front = lerp(X_RANGE[0], X_RANGE[1], band);
      for (let k = 0; k < NX; k++) {
        const [x0, x1] = bandEdges[k];
        if (x0 >= front) break;
        out.push({ type: "rect", xref: "x", yref: "paper", x0, x1: Math.min(x1, front), y0: 0, y1: 1,
                   layer: "below", line: { width: 0 }, fillcolor: rgba(CORR_RGB[k], alpha) });
      }
      return out;
    }
    // Pad the full-height bands past the axis range so no gap shows at the start of conc.
    const pad = 0.05 * (yr[1] - yr[0]);
    const lo = yr[0] - pad, hi = yr[1] + pad;
    const n = (v) => v.toFixed(5);
    for (let k = 0; k < NX; k++) {
      const [x0, x1] = bandEdges[k];
      const xs = [x0, S.x[k], x1];
      const ms = [meanAt(x0), S.mean[k], meanAt(x1)];
      const top = xs.map((x, i) => "L" + n(x) + "," + n(lerp(hi, ms[i], conc)));
      const bot = xs.map((x, i) => "L" + n(x) + "," + n(lerp(lo, ms[i], conc))).reverse();
      const path = "M" + top.join("").slice(1) + bot.join("") + "Z";
      out.push({ type: "path", xref: "x", yref: "y", path, layer: "below", line: { width: 0 },
                 fillcolor: rgba(CORR_RGB[k], alpha) });
    }
    return out;
  });
  // Fig. 3(b) crossing lines: black solid underlay at alpha 0.35, dashed yellow on top.
  const crossShapes = memo(4, (op) => {
    if (op <= 0.01) return [];
    const out = [];
    for (const xc of S.ring_crossings) {
      out.push({ type: "line", xref: "x", yref: "paper", x0: xc, x1: xc, y0: 0, y1: 1, layer: "above",
                 opacity: CROSS_UNDER_ALPHA * op, line: { color: "black", width: INF_UNDER_W } });
      out.push({ type: "line", xref: "x", yref: "paper", x0: xc, x1: xc, y0: 0, y1: 1, layer: "above",
                 opacity: op, line: { color: C.ring, width: INF_W, dash: INF_DASH_PX } });
    }
    return out;
  });

  function layout2(p, xr, yr) {
    const m = geomMargins();
    const axis = (title, range) => ({
      title: { text: title, font: { size: 13 } }, range, autorange: false, showgrid: true, gridcolor: "#e6e6e6",
      zeroline: false, showline: false, ticks: "", tickfont: { size: 11 }, automargin: false,
    });
    return {
      font: { family: PLOT_FONT, size: 13, color: "#465165" },
      margin: { l: m.l, r: m.r, t: m.t, b: m.b, autoexpand: false },
      paper_bgcolor: "#fff", plot_bgcolor: "rgba(0,0,0,0)",
      showlegend: false,
      xaxis: { ...axis("Direction 1 scale", xr), tickvals: D.ticks },
      yaxis: axis("", yr),
      annotations: [
        { xref: "paper", yref: "paper", x: 0, y: 0.5, xshift: -48, textangle: -90,
          text: "Loss", showarrow: false, opacity: 1 - p.sub, font: { size: 13 } },
        { xref: "paper", yref: "paper", x: 0, y: 0.5, xshift: -48, textangle: -90,
          text: "Loss minus loss of diff 1", showarrow: false, opacity: p.sub, font: { size: 13 } },
      ],
      shapes: [...bandShapes(`${p.band}|${p.conc}|${yr}`, p.band, p.conc, yr), ...crossShapes(String(p.cross), p.cross)],
      dragmode: "zoom",
      hovermode: "closest",
    };
  }

  // ---------------------------------------------------------------- colorbar + legend (HTML)
  function setupColorbar() {
    const grad = (stops) => "linear-gradient(to top, " + stops.map((s) => rgb(s)).join(", ") + ")";
    document.getElementById("cbar-loss").style.background = grad(D.colorbars.loss.stops);
    document.getElementById("cbar-corr").style.background = grad(D.colorbars.corr.stops);
    for (const mode of ["loss", "corr"]) {
      const [lo, hi] = D.colorbars[mode].range;
      const ticks = document.createElement("div");
      ticks.id = `cbar-${mode}-ticks`;
      ticks.style.cssText = "position:absolute;inset:0";
      const vals = mode === "loss" ? [0, .25, .5, .75, 1].map(t => lerp(lo, hi, t)) : [-1, -.5, 0, .5, 1];
      ticks.innerHTML = vals.map(v => `<span style="top:${100 * (hi - v) / (hi - lo)}%">${mode === "loss" ? v.toFixed(0) : v.toFixed(1)}</span>`).join("");
      document.getElementById("cbar-ticks").append(ticks);
      const label = document.createElement("span");
      label.id = `cbar-${mode}-label`;
      label.style.cssText = "position:absolute;inset:0";
      label.textContent = mode === "loss" ? "Loss" : "Difficulty/loss correlation";
      document.getElementById("cbar-label").append(label);
    }
    const dash = document.getElementById("inf-dash");
    dash.setAttribute("stroke", C.ring);
    dash.setAttribute("stroke-width", INF_W);
    dash.setAttribute("stroke-dasharray", C.inflection_dash.join(" "));
    document.getElementById("inf-under").setAttribute("stroke-width", INF_UNDER_W);
  }
  function updateColorbar(p) {
    const total = clamp(Math.max(p.cbL, p.cbC), 0, 1);
    const wC = p.cbL + p.cbC > 0 ? p.cbC / (p.cbL + p.cbC) : 0;
    document.getElementById("cbar").style.opacity = total;
    document.getElementById("cbar-corr").style.opacity = wC;
    // Legend swatch: the ring (full-alpha underlay) or the crossing lines (alpha 0.35).
    const ringW = p.ring * (1 - p.ov);
    const legOp = clamp(Math.max(ringW, p.cross), 0, 1);
    document.getElementById("inflegend").style.opacity = legOp;
    document.getElementById("inf-under").setAttribute("stroke-opacity",
      lerp(CROSS_UNDER_ALPHA, 1, ringW / Math.max(1e-6, ringW + p.cross)));
    document.getElementById("cbar-loss-ticks").style.opacity = 1 - wC;
    document.getElementById("cbar-corr-ticks").style.opacity = wC;
    document.getElementById("cbar-loss-label").style.opacity = 1 - wC;
    document.getElementById("cbar-corr-label").style.opacity = wC;
  }

  // ---------------------------------------------------------------- 3D camera
  // A view is { el, camera: {eye, up, center, projection}, aspect }. With an
  // orthographic camera, Plotly v3 zooms on scroll by scaling scene.aspectratio
  // (x, y and z by the same factor); the eye distance does not change the image.
  // So zoom is tracked as k = aspectratio.x and tweened back to the framing scale.
  const gd = document.getElementById("plot");
  const gd2 = document.getElementById("plot2d");
  let lastCam = null; // last known live camera: { eye, center, up, aspect }

  function sceneObj() {
    return gd._fullLayout && gd._fullLayout.scene && gd._fullLayout.scene._scene;
  }
  function readScene() {
    const scene = sceneObj();
    if (!scene || !scene.camera || !scene.glplot) return null;
    try {
      const c = scene.getCamera(); // recomputes the controller matrix, so it includes an ongoing drag
      const a = scene.glplot.getAspectratio();
      return { eye: arr(c.eye), center: arr(c.center), up: arr(c.up), aspect: { x: a.x, y: a.y, z: a.z } };
    } catch (err) {
      return null;
    }
  }
  const liveCamera = () => readScene() || lastCam;

  function trackCamera(ev) {
    const live = readScene();
    if (live) { lastCam = live; return; }
    if (!ev) return;
    const base = lastCam || { eye: [0, 0, 0], center: [0, 0, 0], up: Z_UP, aspect: { x: 1, y: 1, z: params.zasp } };
    const cam = ev["scene.camera"];
    const asp = ev["scene.aspectratio"];
    lastCam = {
      eye: cam && cam.eye ? arr(cam.eye) : base.eye,
      center: cam && cam.center ? arr(cam.center) : base.center,
      up: cam && cam.up ? arr(cam.up) : base.up,
      aspect: asp ? { x: asp.x, y: asp.y, z: asp.z } : base.aspect,
    };
  }

  // Decompose a live camera into the quantities the tween moves.
  function cameraStart(live) {
    const fallback = { center: [0, 0, 0], r: EYE_R, up: Z_UP, k: 1, el: params.el, az: params.az, zasp: params.zasp };
    if (!live) return fallback;
    const v = sub3(live.eye, live.center);
    const r = norm3(v);
    if (!(r > 1e-9)) return fallback;
    const el = clamp((Math.asin(clamp(v[2] / r, -1, 1)) * 180) / Math.PI, -89.9, 89.9);
    const az = Math.hypot(v[0], v[1]) > 1e-9 ? (Math.atan2(v[1], v[0]) * 180) / Math.PI : params.az;
    const k = live.aspect && live.aspect.x > 0 ? live.aspect.x : 1;
    const zasp = live.aspect && live.aspect.z > 0 ? live.aspect.z / k : params.zasp;
    const up = norm3(live.up) > 1e-9 ? live.up.slice() : Z_UP;
    return { center: live.center.slice(), r, up, k, el, az, zasp };
  }

  // Camera for parameters p; `start` (from cameraStart) is blended out as e goes 0 -> 1.
  function viewAt(p, start, e) {
    const el = (p.el * Math.PI) / 180;
    const az = (p.az * Math.PI) / 180;
    const dir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const r = start ? lerp(start.r, EYE_R, e) : EYE_R;
    const center = start ? start.center.map((c) => lerp(c, 0, e)) : [0, 0, 0];
    let up = start ? start.up.map((u, n) => lerp(u, Z_UP[n], e)) : Z_UP.slice();
    const un = norm3(up);
    const crossLen = un > 0 ? norm3([up[1] * dir[2] - up[2] * dir[1], up[2] * dir[0] - up[0] * dir[2],
                                     up[0] * dir[1] - up[1] * dir[0]]) / un : 0;
    // If up is (nearly) parallel to the view direction, use the screen-up of a turntable camera.
    up = crossLen > 1e-4 ? scale3(up, 1 / un)
                         : [-Math.sin(el) * Math.cos(az), -Math.sin(el) * Math.sin(az), Math.cos(el)];
    const targetZoom = framingZoom(p.el);
    const k = start ? lerp(start.k, targetZoom, e) : targetZoom;
    const eye = [center[0] + r * dir[0], center[1] + r * dir[1], center[2] + r * dir[2]];
    // Round to 1e-7 so float noise from reading the live camera does not count as a change.
    const r7 = (v) => v.map((c) => Math.round(c * 1e7) / 1e7);
    const kk = Math.round(k * 1e7) / 1e7;
    return {
      el: p.el,
      camera: { eye: xyz(r7(eye)), up: xyz(r7(up)), center: xyz(r7(center)), projection: { type: "orthographic" } },
      aspect: { x: kk, y: kk, z: Math.round(kk * p.zasp * 1e7) / 1e7 },
    };
  }

  // ---------------------------------------------------------------- 2D/3D handoff geometry
  // At the handoff pose (side view, el = 0, az = -90, responsive zoom) the 3D axis box projects to
  // a rectangle: x range horizontally, z range [FLOOR, Z_TOP] vertically. calibrate()
  // projects the box corners through Plotly's own camera matrices (the same math Plotly
  // uses for 3D hover labels) and sets the 2D margins so its plot area covers exactly
  // that rectangle. The 2D x range and y range equal the 3D x and z ranges there.
  let geom = null; // { l, r, t, b, w, h } in px, for a #plot of size w x h
  const FALLBACK_MARGIN = { l: 90, r: 110, t: 40, b: 70 };

  function atHandoffPose() {
    const live = readScene();
    if (!live) return false;
    const v = sub3(live.eye, live.center);
    const r = norm3(v);
    const k = live.aspect.x;
    return r > 0 && Math.abs(v[2] / r) < 1e-3 && Math.abs(v[0] / r) < 1e-3 && v[1] < 0 &&
           Math.abs(k - framingZoom(0)) < 1e-3 && Math.abs(live.aspect.y - framingZoom(0)) < 1e-3 &&
           Math.abs(live.aspect.z - framingZoom(0) * SIDE.zasp) < 1e-3 && norm3(live.center) < 1e-6;
  }
  function measure() {
    const scene = sceneObj();
    if (!scene || !scene.glplot || !scene.glplot.cameraParams) return null;
    const cp = scene.glplot.cameraParams;
    if (!cp.view || !cp.projection || !cp.model || !scene.dataScale) return null;
    const host = gd.getBoundingClientRect();
    const box = scene.container.getBoundingClientRect();
    const sx = gd.offsetWidth > 0 ? host.width / gd.offsetWidth : 1;
    const sy = gd.offsetHeight > 0 ? host.height / gd.offsetHeight : 1;
    const mul = (m, v) => {
      const out = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) out[rr] += m[4 * c + rr] * v[c];
      return out;
    };
    const ds = scene.dataScale;
    const project = (x, y, z) => {
      const v = mul(cp.projection, mul(cp.view, mul(cp.model, [x * ds[0], y * ds[1], z * ds[2], 1])));
      return [(box.left - host.left + (0.5 + 0.5 * v[0] / v[3]) * box.width) / sx,
              (box.top - host.top + (0.5 - 0.5 * v[1] / v[3]) * box.height) / sy];
    };
    const a = project(X_RANGE[0], 0, FLOOR); // bottom-left of the box
    const b = project(X_RANGE[1], 0, Z_TOP); // top-right
    const W = gd.offsetWidth, H = gd.offsetHeight;
    const g = { l: Math.min(a[0], b[0]), r: W - Math.max(a[0], b[0]), t: Math.min(a[1], b[1]),
                b: H - Math.max(a[1], b[1]), w: W, h: H };
    const ok = [g.l, g.r, g.t, g.b].every((v) => Number.isFinite(v) && v >= 0) &&
               W - g.l - g.r > 50 && H - g.t - g.b > 50;
    return ok ? g : null;
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  // Measure once the gl camera has settled (two equal readings on consecutive frames).
  async function calibrate() {
    if (!atHandoffPose()) return null;
    let prev = null;
    for (let n = 0; n < 30; n++) {
      await nextFrame();
      const g = measure();
      if (g && prev && ["l", "r", "t", "b"].every((key) => Math.abs(g[key] - prev[key]) < 0.25)) return g;
      prev = g;
    }
    return prev;
  }
  const geomValid = () => !!geom && geom.w === gd.offsetWidth && geom.h === gd.offsetHeight;
  function geomMargins() {
    const m = geomValid() ? geom : FALLBACK_MARGIN;
    return { l: Math.round(m.l * 100) / 100, r: Math.round(m.r * 100) / 100,
             t: Math.round(m.t * 100) / 100, b: Math.round(m.b * 100) / 100 };
  }

  // ---------------------------------------------------------------- drawing
  const CONFIG3 = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["resetCameraLastSave3d"] };
  const CONFIG2 = { displaylogo: false, responsive: true, scrollZoom: false };
  const Q3_KEYS = ["h", "c", "surf", "cont", "ring", "slice", "cline", "loff", "cross"];
  const Q2_KEYS = ["split", "sub", "zoom", "ccol", "cross"];
  let current = 0;
  let params = { ...STATES[0] };
  let anim = null; // token of the running animation
  let playing = false;
  let drawing = false; // a Plotly.react call is in flight
  let lastKey3 = null, lastKey2 = null;

  function quantize(p) {
    const out = { ...p };
    for (const key of Q3_KEYS.concat(Q2_KEYS)) out[key] = q(p[key]);
    out.band = Math.round(p.band * 100) / 100; // the band front moves in 1% steps
    out.conc = Math.round(p.conc * 100) / 100; // bands shrinking onto the line
    out.zasp = Math.round(p.zasp * QZASP) / QZASP;
    return out;
  }
  function setOverlay(ov) {
    gd2.style.opacity = ov;
    gd2.style.visibility = ov > 0.001 ? "visible" : "hidden";
    gd2.style.pointerEvents = ov > 0.5 ? "auto" : "none";
  }

  // Draw both plots for parameters p. start/e: 3D camera blend; off2/e2: 2D range blend.
  // A plot is skipped when it is fully hidden or nothing visible changed.
  function draw(p, start, e, off2, e2) {
    updateColorbar(p);
    const key = document.getElementById("difficulty-key");
    const keyOpacity = p.ov * p.split * (1 - p.ccol);
    key.style.opacity = keyOpacity;
    // Open the legend's space during the handoff; reveal its full rows with the colored curves.
    const keySpace = p.ov * (1 - p.ccol);
    key.style.maxHeight = `${key.scrollHeight * keySpace}px`;
    key.style.marginTop = `${12 * keySpace}px`;
    key.querySelectorAll("i").forEach((swatch, d) => {
      swatch.style.background = rgb(mixRgb(MEAN_RGB, DIFF_RGB[d], p.split));
    });
    setOverlay(p.ov);
    const qp = quantize(p);
    const jobs = [];
    // The 3D parameters and camera do not change while the 2D plot is shown (except the
    // hidden H6 switch), so the key check alone keeps the 3D plot idle in steps 3-6.
    const view = viewAt(qp, start, e);
    const key3 = Q3_KEYS.map((k) => qp[k]).join(",") + "|" + JSON.stringify([view.camera, view.aspect]);
    if (key3 !== lastKey3) {
      lastKey3 = key3;
      jobs.push(Plotly.react(gd, traces3(qp), layout3(qp, view), CONFIG3));
    }
    if (p.ov > 0.001 || lastKey2 === null) {
      const k = off2 ? 1 - e2 : 0;
      const yr = yRange2(qp);
      const xr2 = [r4(X_RANGE[0] + k * (off2 ? off2.x[0] : 0)), r4(X_RANGE[1] + k * (off2 ? off2.x[1] : 0))];
      const yr2 = [r4(yr[0] + k * (off2 ? off2.y[0] : 0)), r4(yr[1] + k * (off2 ? off2.y[1] : 0))];
      const m = geomMargins();
      const key2 = Q2_KEYS.map((key) => qp[key]).join(",") + "|" + qp.band + "|" + qp.conc + "|" + xr2 + "|" + yr2 + "|" +
                   [m.l, m.r, m.t, m.b].join(",");
      if (key2 !== lastKey2) {
        lastKey2 = key2;
        jobs.push(Plotly.react(gd2, traces2(qp), layout2(qp, xr2, yr2), CONFIG2));
      }
    }
    return Promise.all(jobs);
  }
  // Offset of the live (user-zoomed) 2D ranges from the ranges parameters p would give.
  function rangeOffset2(p) {
    const fl = gd2._fullLayout;
    if (!fl || !fl.xaxis || !fl.yaxis || p.ov < 0.001) return null;
    const qp = quantize(p);
    const yr = yRange2(qp);
    const x = fl.xaxis.range.map(Number), y = fl.yaxis.range.map(Number);
    if (![...x, ...y].every(Number.isFinite)) return null;
    return { x: [x[0] - X_RANGE[0], x[1] - X_RANGE[1]], y: [y[0] - yr[0], y[1] - yr[1]] };
  }

  const progress = (t, w) => (w ? clamp((t - w[0]) / Math.max(w[1] - w[0], 1e-6), 0, 1) : t);

  // Tween the current parameters to seg.to. Resolves false if superseded by `token` changing.
  function runSegment(seg, token, scale) {
    const target = { ...params, ...seg.to };
    const win = seg.win || {};
    const duration = seg.ms * scale;
    let start = null, start2 = null, from = null, dAz = 0, t0 = 0, triedCal = false;
    return new Promise((resolve) => {
      async function frame(now) {
        if (anim !== token) return resolve(false);
        if (drawing) { requestAnimationFrame(frame); return; } // never stack Plotly.react calls
        if (!from) {
          // Start from wherever the camera / 2D axes are now (user drag, zoom, pan, or a
          // cancelled tween). Read on the first free frame so a pending redraw has been applied.
          start = cameraStart(liveCamera());
          start2 = rangeOffset2(params);
          from = { ...params, el: start.el, az: start.az, zasp: start.zasp };
          dAz = target.az - from.az;
          dAz -= 360 * Math.round(dAz / 360);
          t0 = now;
        }
        let t = duration > 0 ? clamp((now - t0) / duration, 0, 1) : 1;
        const p = {};
        for (const key of Object.keys(target)) p[key] = lerp(from[key], target[key], ease(progress(t, win[key])));
        let eCam = ease(progress(t, win.cam));
        p.el = lerp(from.el, target.el, eCam);
        p.az = from.az + dAz * eCam;
        // Before the 2D plot starts to show, place it on the projected 3D box
        // (the 3D camera is at the handoff pose at this point of every plan).
        if (p.ov > from.ov && from.ov < 0.5 && !geomValid() && !triedCal) {
          triedCal = true;
          const paused = now;
          drawing = true;
          const g = await calibrate();
          drawing = false;
          if (anim !== token) return resolve(false);
          if (g) geom = g;
          const resumed = performance.now();
          t0 += resumed - paused;
          t = duration > 0 ? clamp((resumed - t0) / duration, 0, 1) : 1;
          for (const key of Object.keys(target)) p[key] = lerp(from[key], target[key], ease(progress(t, win[key])));
          eCam = ease(progress(t, win.cam));
          p.el = lerp(from.el, target.el, eCam);
          p.az = from.az + dAz * eCam;
        }
        params = p;
        drawing = true;
        let pending;
        try { pending = draw(p, start, eCam, start2, ease(t)); } catch (err) { pending = Promise.reject(err); }
        pending.catch((err) => console.error(err)).then(() => {
          drawing = false;
          trackCamera();
          if (anim !== token) return resolve(false);
          if (t >= 1) { params = { ...target }; resolve(true); return; }
          requestAnimationFrame(frame);
        });
      }
      requestAnimationFrame(frame);
    });
  }

  // ---------------------------------------------------------------- navigation
  function setCaption(i) {
    const [title, body] = CAPTIONS[i];
    setInteractiveCaption(`<b>${i + 1}/${STATES.length}. ${title}</b>${body}`);
    document.querySelectorAll("#dots span").forEach((el, k) => el.classList.toggle("on", k === i));
    document.getElementById("prev").disabled = i === 0;
    document.getElementById("next").disabled = i === STATES.length - 1;
  }

  // Go to step i by playing every step in between (so the 2D/3D handoffs always happen
  // at the handoff pose). Resolves true if it finished, false if superseded.
  async function goTo(i) {
    i = clamp(i, 0, STATES.length - 1);
    const token = {};
    anim = token;
    const from = current;
    current = i;
    setCaption(i);
    let plan;
    if (i === from) {
      plan = [{ to: STATES[i], ms: 1200, win: {} }]; // re-centre the view of this step
    } else {
      plan = [];
      const dir = i > from ? 1 : -1;
      for (let s = from; s !== i; s += dir) plan.push(...stepPlan(s, s + dir));
    }
    const scale = Math.abs(i - from) > 1 ? JUMP_SCALE : 1;
    for (const seg of plan) {
      const done = await runSegment(seg, token, scale);
      if (!done) return false;
    }
    if (anim === token) anim = null;
    return true;
  }

  async function playAll() {
    playing = true;
    document.getElementById("play").textContent = "Stop";
    if (current === STATES.length - 1) { if (!(await goTo(0))) return stopPlay(); await sleep(800); }
    while (playing && current < STATES.length - 1) {
      const done = await goTo(current + 1);
      if (!done || !playing) break;
      await sleep(1600);
    }
    stopPlay();
  }
  function stopPlay() { playing = false; document.getElementById("play").textContent = "Play all"; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const dots = document.getElementById("dots");
  STATES.forEach((_, k) => {
    const dot = document.createElement("span");
    dot.title = CAPTIONS[k][0];
    dot.addEventListener("click", () => { stopPlay(); goTo(k); });
    dots.appendChild(dot);
  });
  document.getElementById("prev").addEventListener("click", () => { stopPlay(); goTo(current - 1); });
  document.getElementById("next").addEventListener("click", () => { stopPlay(); goTo(current + 1); });
  document.getElementById("play").addEventListener("click", () => (playing ? stopPlay() : playAll()));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight") { stopPlay(); goTo(current + 1); }
    if (ev.key === "ArrowLeft") { stopPlay(); goTo(current - 1); }
  });

  // On resize, Plotly resizes both plots (responsive: true). While the 2D plot is shown
  // the 3D camera is parked at the handoff pose, so re-measure and redraw the 2D plot.
  let resizeTimer = null;
  let plotWidth = gd.offsetWidth, plotHeight = gd.offsetHeight;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      if (anim || drawing || (plotWidth === gd.offsetWidth && plotHeight === gd.offsetHeight)) return;
      plotWidth = gd.offsetWidth;
      plotHeight = gd.offsetHeight;
      drawing = true;
      geom = null;
      lastKey3 = lastKey2 = null;
      try {
        await draw(params, null, 1, null, 1);
        if (params.ov > 0.5) {
          const g = await calibrate();
          if (g) geom = g;
          lastKey2 = null;
          await draw(params, null, 1, null, 1);
        }
      } catch (err) { console.error(err); }
      finally { drawing = false; }
    }, 300);
  });

  const difficultyKey = document.getElementById("difficulty-key");
  const keyTitle = document.createElement("strong");
  keyTitle.textContent = "Difficulty";
  difficultyKey.append(keyTitle);
  C.difficulty_labels.forEach((label, i) => {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.background = C.difficulty[i];
    item.append(swatch, document.createTextNode(label));
    difficultyKey.append(item);
  });
  difficultyKey.hidden = false;
  difficultyKey.style.cssText = "opacity:0;max-height:0;overflow:hidden;margin-top:0";
  setupColorbar();
  setCaption(0);
  drawing = true;
  draw(params, null, 1, null, 1).then(() => {
    drawing = false;
    trackCamera();
    // Follow user drags, scroll zoom and pans so the next step starts from them.
    gd.on("plotly_relayout", trackCamera);
    gd.on("plotly_relayouting", trackCamera);
    // Build the coolwarm surface colors ahead of the 5 -> 6 fade-in.
    setTimeout(() => meshColor("1", 1), 0);
  });
})();
