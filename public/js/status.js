// Stream-health dashboard: player-reported failures plus the Worker's rolling file checks (Cloudflare D1).
import * as api from './api.js';
import { esc, icon, footer, emptyState } from './ui.js';

const rel = (ts) => {
  if (!ts) return 'never';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
// Axis max whose half is also a whole number, so both gridline labels are honest.
const niceMax = (v) => {
  if (v <= 2) return 2;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 4, 6, 8, 10].find((k) => k * p >= v) * p;
};

export async function statusView(ctx) {
  ctx.el.innerHTML = `<div class="view"><div class="container">
    <header class="page-head"><div><div class="eyebrow">Stream status</div><h1 class="page-title">Is it streaming?</h1>
    <p class="page-sub">Every play, failure and automatic recovery is reported anonymously by the player, and a Cloudflare Worker re-checks every catalog file around the clock. Dead files are skipped automatically.</p></div></header>
    <div data-body><div class="stats">${Array.from({ length: 4 }, () => '<div class="skel" style="height:110px;border-radius:24px"></div>').join('')}</div></div>
  </div>${footer()}</div>`;
  let h, films;
  try {
    [h, films] = await Promise.all([api.health(), api.catalog()]);
  } catch {
    if (ctx.alive()) ctx.el.querySelector('[data-body]').innerHTML = emptyState({ iconName: 'pulse', title: 'Status is unavailable', text: 'The health API didn’t respond. Try again in a minute.' });
    return;
  }
  if (!ctx.alive()) return;
  const byId = new Map(films.map((f) => [f.id, f]));
  const t = h.totals || {};
  const plays = t.play || 0, errors = t.error || 0, recovered = (t.recovered || 0) + (t.fallback || 0);
  const c = h.checks || {};

  // Fill 14 days so gaps show as zero rather than vanishing.
  const today = Math.floor(Date.now() / 86400000);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = today - 13 + i;
    const r = (h.byDay || []).find((x) => x.day === d) || {};
    return { day: d, plays: r.plays || 0, errors: r.errors || 0 };
  });
  const yMax = niceMax(Math.max(1, ...days.map((d) => Math.max(d.plays, d.errors))));
  const label = (d) => new Date(d * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  ctx.el.querySelector('[data-body]').innerHTML = `
    <section class="stats" aria-label="Last 14 days">
      <div class="stat glass"><div class="stat__label">Plays</div><div class="stat__value">${plays.toLocaleString()}</div><div class="stat__note">last 14 days</div></div>
      <div class="stat glass"><div class="stat__label">Stream errors</div><div class="stat__value">${errors.toLocaleString()}</div><div class="stat__note">${recovered.toLocaleString()} recovered automatically</div></div>
      <div class="stat glass"><div class="stat__label">Files checked</div><div class="stat__value">${(c.checked || 0).toLocaleString()}<small style="font-size:16px;color:var(--text-3);font-weight:600"> / ${films.length.toLocaleString()}</small></div><div class="stat__note">last run ${esc(rel(c.lastRun))}</div></div>
      <div class="stat glass"><div class="stat__label">Healthy files</div><div class="stat__value">${c.checked ? pct(c.ok || 0, c.checked) + '%' : '—'}</div><div class="stat__note">${(c.dead || 0).toLocaleString()} dead · ${c.avg_ms ? Math.round(c.avg_ms) + ' ms avg' : 'no timing yet'}</div></div>
    </section>

    <figure class="chart glass" style="margin:14px 0 0">
      <figcaption class="chart__head"><span class="chart__title">Plays and stream errors per day</span>
        <span class="legend"><span><i style="background:var(--series-1)"></i>Plays</span><span><i style="background:var(--series-2)"></i>Errors</span></span></figcaption>
      <div class="gbars" role="list" style="--cols:${days.length}">
        <div class="bars__grid" aria-hidden="true">${[1, 0.5].map((f) => `<span style="top:${(1 - f) * 100}%"><em style="font-style:normal;position:relative;top:-16px">${Math.round(yMax * f)}</em></span>`).join('')}</div>
        ${days.map((d, i) => `<div class="gbar" role="listitem" tabindex="0" aria-label="${esc(label(d.day))}: ${d.plays} plays, ${d.errors} errors">
          <i style="--h:${(d.plays / yMax) * 100}%;background:var(--series-1)"></i><i style="--h:${(d.errors / yMax) * 100}%;background:var(--series-2)"></i>
          ${i % 2 === 0 || days.length < 8 ? `<b>${esc(label(d.day))}</b>` : ''}
          <span class="bar__tip"><strong>${esc(label(d.day))}</strong> · ${d.plays} plays · ${d.errors} errors</span></div>`).join('')}
      </div>
      <details class="table-view"><summary>Show as table</summary>
        <table><thead><tr><th>Day</th><th>Plays</th><th>Errors</th></tr></thead><tbody>${days.map((d) => `<tr><td>${esc(label(d.day))}</td><td>${d.plays}</td><td>${d.errors}</td></tr>`).join('')}</tbody></table>
      </details>
    </figure>

    <div class="detail__body" style="margin-top:28px">
      <section class="panel glass">
        <h2 class="section-title">Titles with the most errors</h2>
        ${h.worst?.length ? `<table class="table"><thead><tr><th>Title</th><th>Errors</th><th>Plays</th><th>Recovered</th><th>Last</th></tr></thead><tbody>
          ${h.worst.map((w) => `<tr><td><a href="/title/${encodeURIComponent(w.item)}">${esc(byId.get(w.item)?.title || w.item)}</a></td><td>${w.errors}</td><td>${w.plays}</td><td>${w.recovered}</td><td>${esc(rel(w.last))}</td></tr>`).join('')}
        </tbody></table>` : `<p class="page-sub" style="margin:0">No stream errors reported in the last 14 days. ${icon('check')}</p>`}
      </section>
      <section class="panel glass">
        <h2 class="section-title">Dead files</h2>
        ${h.dead?.length ? `<ul class="dead-list">${h.dead.map((d) => `<li><a href="/title/${encodeURIComponent(d.item)}">${esc(byId.get(d.item)?.title || d.item)}</a><small>HTTP ${d.status || 'timeout'} · ${esc(rel(d.checked_at))}</small></li>`).join('')}</ul>`
          : `<p class="page-sub" style="margin:0">${c.checked ? 'Every checked file is responding.' : 'The first check runs within 30 minutes of deploy.'}</p>`}
      </section>
    </div>`;
}
