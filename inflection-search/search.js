// Algorithm 1 replay with four initial samples on the fixed interval [0, 0.25].
(async function () {
  "use strict";
  await document.fonts.ready;
  const PLOT_FONT = getComputedStyle(document.body).fontFamily;
  const D = window.SEARCH_DATA;
  const GOLD = "#e0a800";
  const FIT = "#1f77b4";
  const GT = "#999";
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const R = D.replay;
  const events = buildEvents(R);
  const stages = [
    { from: -1, to: -1, title: "Find the parabolic basin boundaries",
      body: "We find the boundaries of the parabolic basin—corresponding to inflection points where the curvature changes." },
    { from: 0, to: 1, title: "Initialize the fitted curve",
      body: "We evaluate a few perturbation scales and fit a loss curve to estimate its curvature." },
    { from: 2, to: 3, title: "Increase the search window for the inflection point",
      body: "If the curvature remains positive, we extend the search window and update the fitted curve." },
    { from: 4, to: 5, title: "Recursively evaluate more points",
      body: "We evaluate additional points near the estimated curvature change and refit the curve to refine the inflection point." },
    { from: 6, to: 7, title: "The inflection point is found",
      body: "We identify the inflection point where the curvature changes sign, giving the basin boundary and the perturbation scale for this direction." },
  ];
  const rg = ranges(R);
  let idx = 0;
  let anim = null;
  let playing = false;
  let playGeneration = 0;
  const gd = document.getElementById("plot");

  function buildEvents(r) {
    const ev = [{ kind: "seeds", qs: r.queries.filter((q) => q.after_snapshot === 0) }];
    r.snapshots.forEach((s, j) => {
      ev.push({ kind: "fit", snap: j });
      const t = r.trace[j];
      if (!t) return;
      const q = r.queries.find((qq) => qq.after_snapshot === j + 1);
      if (t.extended_this_iter) {
        ev.push({ kind: "extend", from: s.search_b, to: t.b, t, q });
      } else {
        const isCrossing = t.proposal_kind === "crossing";
        ev.push({ kind: "propose", t, q, isCrossing });
      }
    });
    ev.push({ kind: "done" });
    return ev;
  }

  function ranges(r) {
    const xmax = r.s_max * 1.02;
    let ys = r.truth.y.slice();
    r.snapshots.forEach((s) => { ys = ys.concat(s.y_fit); });
    const d2 = [].concat(...r.snapshots.map((s) => s.d2_fit), ...r.snapshots.map((s) => [s.threshold]));
    const ylo = Math.min(...ys), yhi = Math.max(...ys);
    const dlo = Math.min(...d2), dhi = Math.max(...d2);
    return {
      x: [r.truth.x[0] - 0.02 * xmax, xmax],
      y: [Math.max(0, ylo - 0.08 * (yhi - ylo)), yhi + 0.08 * (yhi - ylo)],
      d2: [dlo - 0.1 * (dhi - dlo), dhi + 0.1 * (dhi - dlo)],
    };
  }
  // Everything shown at event i with progress p in [0, 1] of its animation.
  function state(i, p) {
    const st = { points: [], newest: null, fit: null, prevFit: null, fitFrac: 1, b: R.b_initial,
                 proposal: null, crossing: null, done: 0, truthOnly: i < 0 };
    for (let k = 0; k <= i; k++) {
      const e = events[k];
      const pk = k === i ? p : 1;
      if (e.kind === "seeds") {
        const n = Math.ceil(pk * e.qs.length - 1e-9);
        st.points.push(...e.qs.slice(0, n));
        st.newest = n ? e.qs[n - 1] : null;
      } else if (e.kind === "fit") {
        st.prevFit = st.fit;
        st.fit = R.snapshots[e.snap];
        st.fitFrac = pk;
        st.b = st.fit.search_b;
        st.proposal = null; st.crossing = null; st.newest = null;
      } else if (e.kind === "extend") {
        st.b = lerp(e.from, e.to, ease(clamp(pk / 0.6, 0, 1)));
        st.proposal = { x: e.t.x, show: pk > 0.6, extend: true };
        if (pk > 0.6 && e.q) { st.points.push(e.q); st.newest = e.q; }
      } else if (e.kind === "propose") {
        st.crossing = e.isCrossing ? { x: e.t.x, y: e.t.threshold } : null;
        st.proposal = { x: e.t.x, show: pk > 0.35, extend: false };
        if (pk > 0.7 && e.q) { st.points.push(e.q); st.newest = e.q; }
      } else if (e.kind === "done") {
        st.done = pk; st.newest = null; st.proposal = null; st.crossing = null;
      }
    }
    return st;
  }

  function slice(s, frac) {
    const n = Math.max(2, Math.round(frac * s.x_fit.length));
    return { x: s.x_fit.slice(0, n), y: s.y_fit.slice(0, n), d2: s.d2_fit.slice(0, n) };
  }

  function figure(st, rg, highlights = []) {
    const fit = st.fit ? slice(st.fit, st.fitFrac) : { x: [], y: [], d2: [] };
    const prev = st.prevFit || { x_fit: [], y_fit: [], d2_fit: [] };
    const xs = st.points.map((q) => q.x), ys = st.points.map((q) => q.y);
    const top = { xaxis: "x", yaxis: "y" }, bot = { xaxis: "x2", yaxis: "y2" };
    const traces = [
      { ...top, x: R.truth.x, y: R.truth.y, mode: "lines", name: "Ground truth",
        line: { color: GT, width: 2 },
        hovertemplate: "ε = %{x:.4f}<br>loss = %{y:.2f}<extra>Ground truth</extra>" },
      { ...top, x: prev.x_fit, y: prev.y_fit, mode: "lines", name: "Previous fit",
        line: { color: FIT, width: 1.5, dash: "dot" }, opacity: 0.35, hoverinfo: "skip", showlegend: false },
      { ...top, x: fit.x, y: fit.y, mode: "lines", name: "Fitted curve", line: { color: FIT, width: 2.5 }, hoverinfo: "skip" },
      { ...top, x: xs, y: ys, mode: "markers", name: "Search queries",
        marker: { size: 8, color: "#222" }, hovertemplate: "ε = %{x:.4f}<br>loss = %{y:.2f}<extra></extra>" },
      { ...bot, x: prev.x_fit, y: prev.d2_fit, mode: "lines", line: { color: FIT, width: 1.5, dash: "dot" },
        opacity: 0.35, showlegend: false, hoverinfo: "skip" },
      { ...bot, x: fit.x, y: fit.d2, mode: "lines", line: { color: FIT, width: 2.5 }, showlegend: false, hoverinfo: "skip" },
    ];
    const panels = [{ xref: "x", yref: "y domain" }, { xref: "x2", yref: "y2 domain" }];
    const shapes = panels.flatMap((axes) => [
      { ...axes, type: "rect", x0: R.a, x1: st.b, y0: 0, y1: 1, fillcolor: "rgba(31,119,180,0.07)",
        line: { width: 0 }, layer: "below" },
      { ...axes, type: "line", x0: st.b, x1: st.b, y0: 0, y1: 1, line: { color: FIT, width: 1, dash: "dot" } },
    ]);
    shapes.push({ type: "line", xref: "paper", yref: "y2", x0: 0, x1: 1, y0: 0, y1: 0,
      line: { color: "#999", width: 1 } });
    if (st.proposal && st.proposal.show && st.proposal.extend) panels.forEach((axes) => shapes.push({
      ...axes, type: "line", x0: st.proposal.x, x1: st.proposal.x, y0: 0, y1: 1,
      line: { color: st.proposal.extend ? FIT : GOLD, width: 2, dash: "dash" }, opacity: 0.9,
    }));
    const layout = {
      font: { family: PLOT_FONT, size: 13, color: "#465165" },
      paper_bgcolor: "#fff", plot_bgcolor: "#fff",
      margin: { l: 70, r: 20, t: 20, b: 50 },
      showlegend: true, legend: { x: 0.01, y: 0.99, bgcolor: "rgba(255,255,255,0.85)" },
      xaxis: { range: rg.x, anchor: "y", showticklabels: false, zeroline: false },
      yaxis: { domain: [0.4, 1], range: rg.y, rangemode: "nonnegative", title: { text: "Mean loss" }, zeroline: false },
      xaxis2: { range: rg.x, anchor: "y2", matches: "x", title: { text: "Perturbation scale ε" }, zeroline: false },
      yaxis2: { domain: [0, 0.32], range: rg.d2, title: { text: "d²loss/dε²" }, zeroline: false },
      shapes,
      annotations: [{ xref: "x", yref: "y domain", x: st.b, y: 1, xanchor: "right", yanchor: "bottom",
        text: "search window", showarrow: false, font: { size: 11, color: FIT } },
      ],
    };
    if (st.truthOnly) traces.forEach((trace, i) => { if (i > 0) trace.showlegend = false; });
    for (const layer of highlights) {
      const { kind, x, y, opacity } = layer;
      if (kind === "proposal") {
        panels.forEach(axes => layout.shapes.push({ ...axes, type: "line",
          x0: x, x1: x, y0: 0, y1: 1, opacity: 0.9 * opacity,
          line: { color: GOLD, width: 2, dash: "dash" },
        }));
        continue;
      }
      const marker = kind === "newest"
        ? { size: 16, color: "rgba(0,0,0,0)", line: { color: "#d62728", width: 2.5 } }
        : { size: kind === "star" ? 13 : 10, color: GOLD,
            symbol: kind === "star" ? "star" : "circle", line: { color: "#000", width: 1 } };
      traces.push({ ...(kind === "crossing" ? bot : top), uid: layer.key.replace(/[^a-zA-Z0-9_-]/g, "_"),
        x: [x], y: [y], mode: "markers", marker, opacity, showlegend: false, hoverinfo: "skip" });
      if (kind === "star") layout.annotations.push({
        xref: "x", yref: "y", x, y, xanchor: "right", yanchor: "bottom", xshift: -4, yshift: 3,
        text: "ε<sup>*</sup>", showarrow: false, opacity, font: { size: 22, color: "#333" },
      });
    }
    return { traces, layout };
  }
  // Only highlights fade. Each layer keeps its measured coordinates throughout
  // entry and exit; curves and sampled points retain the original replay behavior.
  const highlightLayers = new Map();
  const FADE_MS = 300;
  let latestState = null, painting = null, repaint = false, fadeFrame = null;
  function opacityAt(layer, now) {
    return lerp(layer.from, layer.to, ease(clamp((now - layer.start) / FADE_MS, 0, 1)));
  }
  function setHighlights(st) {
    const desired = [];
    if (st.newest) desired.push({ kind: "newest", x: st.newest.x, y: st.newest.y });
    if (st.crossing) desired.push({ kind: "crossing", ...st.crossing });
    if (st.proposal && st.proposal.show && !st.proposal.extend)
      desired.push({ kind: "proposal", x: st.proposal.x });
    if (st.done > 0) desired.push({ kind: "star", x: R.x_opt, y: R.y_opt });
    const now = performance.now();
    const wanted = new Set();
    desired.forEach(item => {
      const key = `${item.kind}:${item.x}:${item.y ?? ""}`;
      wanted.add(key);
      if (!highlightLayers.has(key)) highlightLayers.set(key, { ...item, key, from: 0, to: 1, start: now });
    });
    highlightLayers.forEach((layer, key) => {
      const to = wanted.has(key) ? 1 : 0;
      if (layer.to !== to) {
        layer.from = opacityAt(layer, now);
        layer.to = to;
        layer.start = now;
      }
    });
  }
  function paint() {
    if (painting) { repaint = true; return painting; }
    if (fadeFrame !== null) { cancelAnimationFrame(fadeFrame); fadeFrame = null; }
    repaint = false;
    const now = performance.now();
    const layers = [];
    let fading = false;
    highlightLayers.forEach((layer, key) => {
      const opacity = opacityAt(layer, now);
      if (now - layer.start < FADE_MS) fading = true;
      else if (layer.to === 0) { highlightLayers.delete(key); return; }
      layers.push({ ...layer, opacity });
    });
    const { traces, layout } = figure(latestState, rg, layers);
    painting = Plotly.react(gd, traces, layout, { displaylogo: false, responsive: true }).finally(() => {
      painting = null;
      if (fading || repaint) fadeFrame = requestAnimationFrame(() => { fadeFrame = null; paint(); });
    });
    return painting;
  }
  function draw(i, p) {
    latestState = state(i, p);
    setHighlights(latestState);
    return paint();
  }

  const DUR = { seeds: 1500, fit: 1100, extend: 1300, propose: 1200, done: 900 };
  function animate(i) {
    const token = {};
    anim = token;
    const stage = stages[i];
    const sequence = events.slice(stage.from, stage.to + 1);
    const dur = sequence.reduce((sum, event) => sum + DUR[event.kind], 0);
    const t0 = performance.now();
    return new Promise((resolve) => {
      let busy = false;
      function frame(now) {
        if (anim !== token) return resolve(false);
        const elapsed = clamp(now - t0, 0, dur);
        let eventIndex = stage.from;
        let eventElapsed = elapsed;
        while (eventIndex < stage.to && eventElapsed >= DUR[events[eventIndex].kind]) {
          eventElapsed -= DUR[events[eventIndex].kind];
          eventIndex++;
        }
        const p = clamp(eventElapsed / DUR[events[eventIndex].kind], 0, 1);
        const finished = elapsed >= dur;
        if (!busy) {
          busy = true;
          draw(eventIndex, p).then(() => {
            busy = false;
            if (anim !== token) { resolve(false); return; }
            if (finished) { anim = null; resolve(true); }
          });
          if (finished) return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  function show(i, animated) {
    idx = clamp(i, 0, stages.length - 1);
    const { title, body } = stages[idx];
    document.getElementById("caption").innerHTML = `<b>${idx + 1}/${stages.length}. ${title}</b>${body}`;
    document.querySelectorAll("#dots span").forEach((dot, k) => dot.classList.toggle("on", k === idx));
    document.getElementById("prev").disabled = idx === 0;
    document.getElementById("next").disabled = idx === stages.length - 1;
    if (animated && idx > 0) return animate(idx);
    anim = null;
    return draw(stages[idx].to, 1).then(() => true);
  }


  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function play() {
    const generation = ++playGeneration;
    playing = true;
    document.getElementById("play").textContent = "Stop";
    if (idx === stages.length - 1) { await show(0, true); await sleep(900); }
    while (playing && generation === playGeneration && idx < stages.length - 1) {
      const ok = await show(idx + 1, true);
      if (!ok || !playing || generation !== playGeneration) break;
      await sleep(1400);
    }
    if (generation === playGeneration) stopPlay();
  }
  function stopPlay() { playing = false; playGeneration++; anim = null; document.getElementById("play").textContent = "Play all"; }

  stages.forEach((stage, k) => {
    const dot = document.createElement("span");
    dot.title = stage.title;
    dot.addEventListener("click", () => {
      const forward = k > idx;
      stopPlay();
      show(k, forward);
    });
    document.getElementById("dots").append(dot);
  });

  document.getElementById("prev").addEventListener("click", () => { stopPlay(); show(idx - 1, false); });
  document.getElementById("next").addEventListener("click", () => { stopPlay(); show(idx + 1, true); });
  document.getElementById("play").addEventListener("click", () => (playing ? stopPlay() : play()));
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest("button")) return;
    if (ev.key === "ArrowRight") { stopPlay(); show(idx + 1, true); }
    if (ev.key === "ArrowLeft") { stopPlay(); show(idx - 1, false); }
  });
  show(0, true);
})();
