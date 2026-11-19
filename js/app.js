/* ==========================================================
   Draft Room 2026 — lógica de la app
   Depende de js/data.js (BYES y RAW).
   ========================================================== */

/* ---------- Configuración de la liga ---------- */
const TEAMS = 12;
const ROUNDS = 16;
const MY_TEAM = 2;
const TOTAL_PICKS = TEAMS * ROUNDS;
const STORE_KEY = 'draftroom2026_v2';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];
const FLEX_POS = ['RB', 'WR', 'TE'];

// Cortes de tier por ranking dentro de la posición.
const TIER_CUTS = {
  QB: [3, 8, 14, 20], RB: [6, 14, 24, 36], WR: [6, 15, 26, 40],
  TE: [3, 8, 14, 20], DST: [4, 7, 12, 16], K: [4, 8, 12, 16],
};

const ROSTER_SLOTS = [
  { id: 'QB', label: 'QB', pos: ['QB'] },
  { id: 'RB1', label: 'RB', pos: ['RB'] },
  { id: 'RB2', label: 'RB', pos: ['RB'] },
  { id: 'WR1', label: 'WR', pos: ['WR'] },
  { id: 'WR2', label: 'WR', pos: ['WR'] },
  { id: 'TE', label: 'TE', pos: ['TE'] },
  { id: 'FLEX', label: 'FLEX', pos: FLEX_POS },
  { id: 'DST', label: 'DST', pos: ['DST'] },
  { id: 'K', label: 'K', pos: ['K'] },
  ...Array.from({ length: 7 }, (_, i) => ({ id: 'BN' + (i + 1), label: 'BN', pos: POSITIONS, bench: true })),
];

/* ---------- Jugadores ---------- */
const PLAYERS = (() => {
  const counters = {};
  return RAW.map(([rank, name, team, pos], id) => {
    counters[pos] = (counters[pos] || 0) + 1;
    const posRank = counters[pos];
    const cuts = TIER_CUTS[pos];
    let tier = cuts.findIndex(c => posRank <= c) + 1;
    if (tier === 0) tier = cuts.length + 1;
    return { id, rank, name, team, pos, posRank, tier, bye: BYES[team] || null };
  });
})();

/* ---------- Draft: orden snake ---------- */
const roundOf = pick => Math.ceil(pick / TEAMS);
function teamOnClock(pick) {
  const round = roundOf(pick);
  const slot = pick - (round - 1) * TEAMS;
  return round % 2 === 1 ? slot : TEAMS - slot + 1;
}
function nextPickFor(team, fromPick) {
  for (let p = fromPick; p <= TOTAL_PICKS; p++) if (teamOnClock(p) === team) return p;
  return null;
}
const teamLabel = t => (t === MY_TEAM ? 'Tú' : 'Equipo ' + t);
const pad = (n, len) => String(n).padStart(len, '0');

/* ---------- Estado ---------- */
let state = { currentPick: 1, log: [] };
const ui = { pos: 'ALL', view: 'players' };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.log)) state = { ...state, ...saved };
  } catch (e) { /* almacenamiento no disponible: se usa el estado vacío */ }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* sin persistencia */ }
}

const isOver = () => state.currentPick > TOTAL_PICKS;
function draftedMap() {
  const m = new Map();
  state.log.forEach(l => m.set(l.playerId, l));
  return m;
}

/* ---------- Roster de un equipo ---------- */
function rosterFor(team) {
  const slots = Object.fromEntries(ROSTER_SLOTS.map(s => [s.id, null]));
  state.log
    .filter(l => l.team === team)
    .forEach(l => {
      const p = PLAYERS[l.playerId];
      const starter = ROSTER_SLOTS.find(s => !s.bench && !slots[s.id] && s.pos.includes(p.pos));
      const target = starter || ROSTER_SLOTS.find(s => s.bench && !slots[s.id]);
      if (target) slots[target.id] = p;
    });
  return slots;
}

/* ---------- Acciones ---------- */
function draftPlayer(id) {
  if (isOver() || draftedMap().has(id)) return;
  const team = teamOnClock(state.currentPick);
  state.log.push({ pick: state.currentPick, team, playerId: id });
  state.currentPick++;
  save();
  render();
  if (team === MY_TEAM) toast(`${PLAYERS[id].name} es tuyo`, true);
}

function undo() {
  const last = state.log.pop();
  if (!last) return;
  state.currentPick = last.pick;
  save();
  render();
  toast(`Pick ${last.pick} deshecho`);
}

function resetDraft() {
  if (!confirm('¿Reiniciar el draft? Se borran todos los picks.')) return;
  state = { currentPick: 1, log: [] };
  save();
  render();
}

/* ---------- Sugerencias ---------- */
function starterNeeds(slots) {
  const count = pos => Object.values(slots).filter(p => p && p.pos === pos).length;
  return {
    QB: Math.max(0, 1 - count('QB')), RB: Math.max(0, 2 - count('RB')), WR: Math.max(0, 2 - count('WR')),
    TE: Math.max(0, 1 - count('TE')), DST: Math.max(0, 1 - count('DST')), K: Math.max(0, 1 - count('K')),
  };
}

function suggestions(limit = 5) {
  const slots = rosterFor(MY_TEAM);
  const needs = starterNeeds(slots);
  const drafted = draftedMap();
  const byeLoad = {};
  Object.values(slots).forEach(p => { if (p && p.bye) byeLoad[p.bye] = (byeLoad[p.bye] || 0) + 1; });
  const round = roundOf(Math.min(state.currentPick, TOTAL_PICKS));

  return PLAYERS
    .filter(p => !drafted.has(p.id))
    .filter(p => round >= 13 || (p.pos !== 'K' && p.pos !== 'DST')) // K y DST solo al final
    .map(p => {
      let score = 300 - p.rank;
      const need = needs[p.pos];
      let why = 'Mejor valor disponible';
      if (need > 0) { score += 15 * need; why = `Llena tu ${p.pos} titular`; }
      else if (FLEX_POS.includes(p.pos) && !slots.FLEX) { score += 8; why = 'Candidato para tu FLEX'; }
      const clash = byeLoad[p.bye] || 0;
      if (clash >= 2) { score -= clash * 10; why += `, pero choca con ${clash} byes de semana ${p.bye}`; }
      return { p, score, why };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ---------- Render ---------- */
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const posTag = pos => `<span class="pos pos-${pos}">${pos}</span>`;

function renderScoreboard() {
  const sb = $('scoreboard');
  if (isOver()) {
    $('sbPick').textContent = '---';
    $('sbRound').textContent = '--';
    $('sbTeam').textContent = 'Draft terminado';
    $('sbNext').textContent = 'Revisa tu roster';
    sb.classList.remove('is-mine');
  } else {
    const onClock = teamOnClock(state.currentPick);
    const mine = onClock === MY_TEAM;
    $('sbPick').textContent = pad(state.currentPick, 3);
    $('sbRound').textContent = pad(roundOf(state.currentPick), 2);
    $('sbTeam').textContent = mine ? 'Te toca' : teamLabel(onClock);
    const next = nextPickFor(MY_TEAM, state.currentPick + (mine ? 1 : 0));
    const gap = next ? next - state.currentPick : null;
    $('sbNext').textContent = next ? `#${next} (faltan ${gap})` : 'Ya no tienes picks';
    sb.classList.toggle('is-mine', mine);
  }
  $('undoBtn').disabled = state.log.length === 0;
}

function renderPosFilter() {
  const wrap = $('posFilter');
  const opts = ['ALL', ...POSITIONS];
  wrap.style.setProperty('--count', opts.length);
  wrap.innerHTML = '';
  opts.forEach(o => {
    const label = el('label');
    label.innerHTML = `<input type="radio" name="pos" value="${o}" ${o === ui.pos ? 'checked' : ''}><span>${o === 'ALL' ? 'Todos' : o}</span>`;
    label.querySelector('input').addEventListener('change', () => { ui.pos = o; renderTable(); });
    wrap.appendChild(label);
  });
  wrap.appendChild(el('span', 'selection'));
}

function filteredPlayers() {
  const q = $('search').value.trim().toLowerCase();
  const hideTaken = $('hideTaken').checked;
  const drafted = draftedMap();
  return PLAYERS.filter(p =>
    (ui.pos === 'ALL' || p.pos === ui.pos) &&
    (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
    (!hideTaken || !drafted.has(p.id))
  );
}

function renderTable() {
  const body = $('playerBody');
  const drafted = draftedMap();
  const rows = filteredPlayers();
  const mine = !isOver() && teamOnClock(state.currentPick) === MY_TEAM;
  body.innerHTML = '';
  $('emptyState').hidden = rows.length > 0;

  const frag = document.createDocumentFragment();
  rows.forEach(p => {
    const d = drafted.get(p.id);
    const tr = el('tr', d ? 'is-taken' : '');
    tr.innerHTML = `
      <td class="c-rank">${p.rank}</td>
      <td><div class="p-name">${p.name}</div><div class="p-sub">${p.team}${d ? `, elegido por ${teamLabel(d.team)} en el pick ${d.pick}` : ''}</div></td>
      <td>${posTag(p.pos)}</td>
      <td class="c-num">${p.bye || '–'}</td>
      <td><span class="tier tier-${p.tier}">Tier ${p.tier}</span></td>
      <td class="c-action"></td>`;
    if (!d && !isOver()) {
      const btn = el('button', 'btn btn-small' + (mine ? ' btn-primary' : ''), mine ? 'Elegir' : 'Marcar');
      btn.title = mine ? 'Agregar a tu roster' : `Marcar como elegido por ${teamLabel(teamOnClock(state.currentPick))}`;
      btn.addEventListener('click', () => draftPlayer(p.id));
      tr.lastElementChild.appendChild(btn);
    }
    frag.appendChild(tr);
  });
  body.appendChild(frag);
}

function renderRoster() {
  const slots = rosterFor(MY_TEAM);
  const list = $('myRoster');
  list.innerHTML = '';
  let benchMarked = false;
  ROSTER_SLOTS.forEach(s => {
    const p = slots[s.id];
    const li = el('li');
    if (s.bench && !benchMarked) { li.classList.add('bench-start'); benchMarked = true; }
    li.innerHTML = `<span class="slot">${s.label}</span>` +
      (p ? `<span class="p-name">${p.name}</span><span class="bye">${p.pos} · bye ${p.bye || '–'}</span>`
         : `<span class="open">Libre</span><span></span>`);
    list.appendChild(li);
  });
}

function renderSuggestions() {
  const list = $('suggestions');
  list.innerHTML = '';
  if (isOver()) { list.appendChild(el('li', '', 'El draft terminó.')); return; }
  const mine = teamOnClock(state.currentPick) === MY_TEAM;
  suggestions().forEach(({ p, why }) => {
    const li = el('li', 'b-' + p.pos);
    li.innerHTML = `<div><span class="p-name">${p.name}</span> ${posTag(p.pos)}</div>`;
    const btn = el('button', 'btn btn-small' + (mine ? ' btn-primary' : ''), mine ? 'Elegir' : 'Marcar');
    btn.addEventListener('click', () => draftPlayer(p.id));
    li.appendChild(btn);
    li.appendChild(el('div', 'why', `ADP ${p.rank}, tier ${p.tier}. ${why}.`));
    list.appendChild(li);
  });

  // Aviso de bye weeks acumulados
  const warn = $('warnBox');
  warn.innerHTML = '';
  const load = {};
  Object.values(rosterFor(MY_TEAM)).forEach(p => { if (p && p.bye) load[p.bye] = (load[p.bye] || 0) + 1; });
  Object.entries(load).filter(([, c]) => c >= 3).forEach(([w, c]) => {
    warn.appendChild(el('div', 'warn', `Tienes ${c} jugadores con bye en la semana ${w}.`));
  });
}

function renderLog() {
  const list = $('log');
  list.innerHTML = '';
  if (!state.log.length) { list.appendChild(el('li', 'log-empty', 'Todavía no hay picks. Marca al primer jugador elegido en tu draft.')); return; }
  state.log.slice(-30).reverse().forEach(l => {
    const p = PLAYERS[l.playerId];
    const li = el('li', l.team === MY_TEAM ? 'is-me' : '');
    li.innerHTML = `<span class="lp">${l.pick}</span><span>${posTag(p.pos)} <strong>${p.name}</strong> <span class="lt">${teamLabel(l.team)}</span></span>`;
    list.appendChild(li);
  });
}

function renderGrid() {
  const byPick = new Map(state.log.map(l => [l.pick, l]));
  let html = '<table class="draft-grid"><thead><tr><th></th>';
  for (let t = 1; t <= TEAMS; t++) html += `<th class="${t === MY_TEAM ? 'is-me' : ''}">${t === MY_TEAM ? 'Tú' : 'E' + t}</th>`;
  html += '</tr></thead><tbody>';
  for (let r = 1; r <= ROUNDS; r++) {
    html += `<tr><td class="r-label">R${r}</td>`;
    // columnas por equipo: buscamos el pick de cada equipo en esta ronda
    for (let t = 1; t <= TEAMS; t++) {
      const slot = r % 2 === 1 ? t : TEAMS - t + 1;
      const overall = (r - 1) * TEAMS + slot;
      const l = byPick.get(overall);
      const p = l ? PLAYERS[l.playerId] : null;
      const cls = [t === MY_TEAM ? 'is-me' : '', overall === state.currentPick ? 'is-now' : '', p ? 'f-' + p.pos : ''].join(' ');
      html += `<td class="${cls}">${p ? `<span class="g-name">${p.name}</span>` : ''}<span class="g-pick">${overall}</span></td>`;
    }
    html += '</tr>';
  }
  $('boardGrid').innerHTML = html + '</tbody></table>';
}

function render() {
  renderScoreboard();
  renderTable();
  renderRoster();
  renderSuggestions();
  renderLog();
  if (ui.view === 'grid') renderGrid();
}

/* ---------- Avisos ---------- */
function toast(text, mine = false) {
  const t = el('div', 'toast' + (mine ? ' is-mine' : ''), `<span class="toast-dot"></span><span>${text}</span>`);
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 300); }, 2600);
}

/* ---------- Eventos ---------- */
function setView(view) {
  ui.view = view;
  document.querySelectorAll('.view-tab').forEach(b => {
    const active = b.dataset.view === view;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active);
  });
  $('view-players').hidden = view !== 'players';
  $('view-grid').hidden = view !== 'grid';
  if (view === 'grid') renderGrid();
}

function bindEvents() {
  $('search').addEventListener('input', renderTable);
  $('hideTaken').addEventListener('change', renderTable);
  $('undoBtn').addEventListener('click', undo);
  $('resetBtn').addEventListener('click', resetDraft);
  document.querySelectorAll('.view-tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'radio';
    if (e.key === '/' && !typing) { e.preventDefault(); $('search').focus(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
  });
}

load();
renderPosFilter();
bindEvents();
render();
