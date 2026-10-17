// Keyboard shortcut cheat sheet: press ? anywhere.
import { esc, icon } from './ui.js';

const GROUPS = [
  ['Anywhere', [['?', 'Show this cheat sheet'], ['/', 'Search'], ['Ctrl / ⌘ K', 'Search'], ['Esc', 'Close a panel or sheet']]],
  ['Player', [
    ['Space · K', 'Play / pause'], ['← →', 'Back / forward 5 s'], ['J · L', 'Back / forward 10 s'], ['↑ ↓', 'Volume'],
    ['0 – 9', 'Jump to 0 %–90 %'], ['M', 'Mute'], ['F', 'Full screen'], ['P', 'Picture in picture'], ['T', 'Cinema mode'],
    ['C', 'Subtitles'], ['S', 'Scenes'], ['N', 'Skip intro / credits'], ['< · >', 'Slower / faster'], ['G', 'Smart speed on/off'],
  ]],
  ['Shorts', [['↑ ↓ · J K', 'Previous / next clip']]],
];

let open = null;

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    open ? close() : show();
  });
}

export function show() {
  if (open) return;
  const m = document.createElement('div');
  m.className = 'modal modal--sheet';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', 'Keyboard shortcuts');
  m.innerHTML = `<div class="modal__scrim" data-close></div>
    <div class="modal__box shortcuts glass">
      <div class="shortcuts__head"><strong>Keyboard shortcuts</strong><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="shortcuts__grid">${GROUPS.map(([g, rows]) => `<section><h3>${esc(g)}</h3><dl>${rows.map(([k, d]) => `<div><dt>${k.split(' · ').map((x) => `<kbd>${esc(x)}</kbd>`).join('<span>or</span>')}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></section>`).join('')}</div>
    </div>`;
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('is-open'));
  const onKey = (e) => e.key === 'Escape' && close();
  m.addEventListener('click', (e) => e.target.closest('[data-close]') && close());
  document.addEventListener('keydown', onKey, true);
  open = { m, onKey };
}

function close() {
  if (!open) return;
  const { m, onKey } = open;
  open = null;
  document.removeEventListener('keydown', onKey, true);
  m.classList.remove('is-open');
  setTimeout(() => m.remove(), 350);
}
