// Seasonal home pages: Halloween, the holidays and Valentine's Day re-theme the hero, the ambient
// light and a featured row, with a light particle layer (bats, snow, hearts). Preview any season
// with ?season=halloween|holidays|valentines.

const SEASONS = {
  halloween: {
    title: '31 Nights of Fright',
    eyebrow: 'Halloween',
    sub: 'A free fright for every night of October',
    tags: ['halloween', 'horror'],
    amb: ['255, 122, 26', '120, 40, 200'],
    accent: '#ff8a1f',
    particles: 'bats',
    countdownTo: (y) => new Date(y, 9, 31),
    countdownLabel: 'Halloween',
  },
  holidays: {
    title: 'Holiday Classics',
    eyebrow: 'Happy holidays',
    sub: 'Cosy, festive and free',
    tags: ['christmas', 'family', 'musical', 'romance'],
    amb: ['220, 40, 60', '30, 150, 90'],
    accent: '#ff4d5e',
    particles: 'snow',
    countdownTo: (y) => new Date(y, 11, 25),
    countdownLabel: 'Christmas',
  },
  valentines: {
    title: 'Love at First Sight',
    eyebrow: 'Valentine’s',
    sub: 'Golden-age romance for two',
    tags: ['romance'],
    amb: ['255, 80, 140', '160, 60, 200'],
    accent: '#ff5c93',
    particles: 'hearts',
    countdownTo: (y) => new Date(y, 1, 14),
    countdownLabel: 'Valentine’s Day',
  },
};

export function currentSeason(now = new Date()) {
  const forced = new URLSearchParams(location.search).get('season');
  if (forced === 'none') return null;
  if (SEASONS[forced]) return { id: forced, ...SEASONS[forced] };
  const m = now.getMonth() + 1, d = now.getDate();
  const id = (m === 10 || (m === 11 && d <= 2)) ? 'halloween' : (m === 12 || (m === 1 && d <= 6)) ? 'holidays' : (m === 2 && d <= 15) ? 'valentines' : null;
  return id ? { id, ...SEASONS[id] } : null;
}

export function daysUntil(season, now = new Date()) {
  const target = season.countdownTo(now.getFullYear());
  const days = Math.ceil((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400e3);
  return days;
}

export function applySeason(season) {
  const root = document.documentElement;
  if (!season) {
    delete root.dataset.season;
    return;
  }
  root.dataset.season = season.id;
  root.style.setProperty('--season-accent', season.accent);
  root.style.setProperty('--amb-1', season.amb[0]);
  root.style.setProperty('--amb-2', season.amb[1]);
}

/** Drifting particles inside `host`. Cheap: ~24 shapes on a canvas, paused when hidden. */
export function particles(host, kind) {
  if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const c = document.createElement('canvas');
  c.className = 'season-particles';
  c.setAttribute('aria-hidden', 'true');
  host.appendChild(c);
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  let w = 0, h = 0, raf = 0, last = performance.now();
  const resize = () => {
    w = host.clientWidth;
    h = host.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const n = kind === 'snow' ? 60 : 18;
  const P = Array.from({ length: n }, () => ({
    x: Math.random() * w, y: Math.random() * h, s: 0.5 + Math.random(), a: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * (kind === 'bats' ? 50 : 14), vy: kind === 'snow' ? 18 + Math.random() * 30 : kind === 'hearts' ? -(10 + Math.random() * 18) : -(4 + Math.random() * 10),
  }));
  const draw = (p, t) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (kind === 'snow') {
      ctx.globalAlpha = 0.35 + p.s * 0.35;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 1 + p.s * 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'hearts') {
      const r = 4 + p.s * 5;
      ctx.globalAlpha = 0.25 + p.s * 0.25;
      ctx.fillStyle = '#ff6b9a';
      ctx.beginPath();
      ctx.moveTo(0, r * 0.35);
      ctx.bezierCurveTo(-r, -r * 0.4, -r * 0.5, -r * 1.1, 0, -r * 0.45);
      ctx.bezierCurveTo(r * 0.5, -r * 1.1, r, -r * 0.4, 0, r * 0.35);
      ctx.fill();
    } else {
      // Bat: two flapping wings.
      const flap = Math.sin(t / 120 + p.a) * 0.6;
      const r = 6 + p.s * 8;
      ctx.globalAlpha = 0.3 + p.s * 0.3;
      ctx.fillStyle = '#0b0710';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-r * 0.6, -r * (0.6 + flap), -r * 1.4, -r * 0.1 * (1 + flap));
      ctx.quadraticCurveTo(-r * 0.7, r * 0.1, -r * 0.4, r * 0.35);
      ctx.quadraticCurveTo(0, r * 0.1, r * 0.4, r * 0.35);
      ctx.quadraticCurveTo(r * 0.7, r * 0.1, r * 1.4, -r * 0.1 * (1 + flap));
      ctx.quadraticCurveTo(r * 0.6, -r * (0.6 + flap), 0, 0);
      ctx.fill();
    }
    ctx.restore();
  };
  const tick = (t) => {
    raf = requestAnimationFrame(tick);
    if (document.hidden) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    ctx.clearRect(0, 0, w, h);
    for (const p of P) {
      p.x += (p.vx + Math.sin(t / 1500 + p.a) * 8) * dt;
      p.y += p.vy * dt;
      if (p.y > h + 20) p.y = -20;
      if (p.y < -20) p.y = h + 20;
      if (p.x > w + 30) p.x = -30;
      if (p.x < -30) p.x = w + 30;
      draw(p, t);
    }
  };
  raf = requestAnimationFrame(tick);
  addEventListener('resize', resize);
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    c.remove();
  };
}
