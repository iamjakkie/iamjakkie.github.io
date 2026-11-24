(() => {
  // ---- mission elapsed time since the last calibration attempt ----
  const T0 = Date.UTC(2026, 7, 30, 12, 18, 21);
  const metEl = document.getElementById('met');
  const pad = (n) => String(n).padStart(2, '0');
  function tickMet() {
    let s = Math.max(0, Math.floor((Date.now() - T0) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    metEl.textContent = `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  tickMet(); setInterval(tickMet, 1000);

  // ---- the estimate ----
  const cv = document.getElementById('scope');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const el = (id) => document.getElementById(id);
  const rSigma = el('r-sigma'), rNees = el('r-nees'), rWhere = el('r-where'), rState = el('r-state');
  const note = el('note'), scaleEl = el('scale');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S0 = 1.3;
  const GROWTH = 0.33;          // e-folding per second. Real INS drift is slower. Not much slower.
  let sigma = S0, angle = 0.4, dir = Math.random() * Math.PI * 2;
  let zoom = 45 / S0;           // px per metre, smoothed
  let zoomTarget = zoom;
  let nees = 2.9, neesT = 0;
  let paused = reduce, last = performance.now(), cooldown = 0;

  const places = [
    [15, 'the garden'],
    [300, 'the field, probably'],
    [5e3, 'this village, roughly'],
    [8e4, 'the region'],
    [7e5, 'Poland-ish'],
    [3e6, 'Europe, broadly'],
    [2e7, 'Earth'],
    [4e8, 'Earth–Moon system'],
    [3e10, 'Mars? possibly'],
    [Infinity, 'beyond reason'],
  ];
  const where = (s) => places.find(([lim]) => s < lim)[1];
  function state(s) {
    if (s < 15) return ['NOMINAL', 'ok'];
    if (s < 5e3) return ['DEGRADED', 'warn'];
    if (s < 3e6) return ['OPTIMISTIC', 'warn'];
    return ['LOL', 'bad'];
  }
  function fmt(m) {
    if (m < 1000) return `${m.toFixed(m < 10 ? 1 : 0)} m`;
    if (m < 1e6) return `${(m / 1000).toFixed(m < 1e4 ? 1 : 0)} km`;
    if (m < 1.496e11 * 0.01) return `${Math.round(m / 1000).toLocaleString('en-GB')} km`;
    return `${(m / 1.496e11).toFixed(2)} AU`;
  }
  function niceUnit(m) {
    const p = Math.pow(10, Math.floor(Math.log10(m)));
    const f = m / p;
    return (f < 2 ? 1 : f < 5 ? 2 : 5) * p;
  }

  const notes = {
    fix: ['Fix acquired. 9 satellites, 0 excuses.', 'GPS says hi. Ellipse humbled.', 'Fix acquired. Back to the garden.'],
    diverge: 'Filter diverged. Rebooting. This is fine.',
    moon: 'NEES still ≈ 3. Lost, but honest about it.',
  };
  let saidMoon = false;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function draw() {
    ctx.fillStyle = '#0f1113';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;

    // grid in "nice" metric units
    const unit = niceUnit(140 / zoom);
    const step = unit * zoom;
    ctx.strokeStyle = 'rgba(239,236,228,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = cx % step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = cy % step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(239,236,228,0.18)';
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

    // truth
    ctx.strokeStyle = '#efece4'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7); ctx.stroke();

    // estimate: offset drifts with the uncertainty, which is the honest part
    const off = sigma * 0.75 * zoom;
    const ex = cx + Math.cos(dir) * off, ey = cy + Math.sin(dir) * off;

    // 1σ and 3σ ellipses
    for (const [k, a] of [[3, 0.18], [1, 0.55]]) {
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(2, sigma * k * zoom), Math.max(1.5, sigma * 0.62 * k * zoom), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(232,72,12,${a + 0.25})`;
      ctx.fillStyle = `rgba(232,72,12,${a * 0.25})`;
      ctx.lineWidth = k === 1 ? 2 : 1;
      ctx.setLineDash(k === 3 ? [6, 6] : []);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff7a45';
    ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI * 2); ctx.fill();

    // labels
    const k = W / Math.max(1, cv.clientWidth || W);
    ctx.font = `500 ${Math.round(13 * Math.max(1, k))}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#efece4';
    ctx.fillText('truth', cx + 10, cy - 10);
    const lx = Math.min(W - 90 * Math.max(1, k), Math.max(10, ex + 10)), ly = Math.min(H - 40, Math.max(20, ey + 20));
    ctx.fillStyle = '#ff7a45';
    ctx.fillText('estimate', lx, ly);

    // scale bar
    ctx.fillStyle = '#efece4';
    ctx.fillRect(18, H - 24, step, 2);
    ctx.fillRect(18, H - 30, 2, 8); ctx.fillRect(18 + step - 2, H - 30, 2, 8);
    ctx.fillText(fmt(unit), 18, H - 30 - 8 * Math.max(1, k));
    scaleEl.textContent = `grid: ${fmt(unit)}`;
  }

  function readouts() {
    rSigma.textContent = fmt(sigma);
    rNees.textContent = nees.toFixed(1);
    rWhere.textContent = where(sigma);
    const [s, c] = state(sigma);
    rState.textContent = s; rState.className = c;
  }

  function step(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) {
      if (cooldown > 0) {
        cooldown -= dt;
        sigma += (S0 - sigma) * Math.min(1, dt * 6);
      } else {
        sigma *= Math.exp(GROWTH * dt);
        angle += dt * 0.15;
        dir += (Math.random() - 0.5) * dt * 0.6;
      }
      neesT -= dt;
      if (neesT <= 0) { nees = 1.6 + Math.random() * 2.6; neesT = 0.6; }
      if (!saidMoon && sigma > 4e8) { note.textContent = notes.moon; saidMoon = true; }
      if (sigma > 3e11) { note.textContent = notes.diverge; cooldown = 1.2; saidMoon = false; }
    }
    // let the ellipse visibly grow, then zoom out in steps
    if (sigma * zoomTarget > 190 || sigma * zoomTarget < 25) zoomTarget = 45 / sigma;
    zoom *= Math.pow(zoomTarget / zoom, Math.min(1, dt * 2.5));
    draw(); readouts();
    requestAnimationFrame(step);
  }

  el('fix').addEventListener('click', () => {
    cooldown = 1.0; saidMoon = false; dir = Math.random() * Math.PI * 2;
    note.textContent = pick(notes.fix);
    if (paused) { paused = false; syncPause(); }
  });
  const pauseBtn = el('pause');
  function syncPause() { pauseBtn.textContent = paused ? 'Resume' : 'Pause'; pauseBtn.setAttribute('aria-pressed', String(paused)); }
  pauseBtn.addEventListener('click', () => { paused = !paused; syncPause(); });
  if (reduce) { sigma = 40; zoom = zoomTarget = 90 / sigma; }
  syncPause();
  requestAnimationFrame((t) => { last = t; step(t); });

  // ---- abort ----
  const dlg = el('dlg'), dlgT = el('dlg-t'), abortBtn = el('abort'), closeBtn = el('dlg-close');
  const refusals = [
    'Insufficient permissions. The mission is not optional.',
    'Request logged. Request ignored.',
    'Abort requires two-person authorisation. There is one person.',
    'Have you tried turning the PhD off and on again? No. You can\'t.',
  ];
  let n = 0;
  abortBtn.addEventListener('click', () => {
    dlgT.textContent = refusals[n++ % refusals.length];
    dlg.hidden = false; closeBtn.focus();
  });
  const close = () => { dlg.hidden = true; abortBtn.focus(); };
  closeBtn.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.hidden) close(); });
})();
