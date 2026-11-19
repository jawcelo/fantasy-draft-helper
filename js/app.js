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
let state = { currentPick: 1, log: [], watch: [] };
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
      // Si ya no hay lugar, se agrega como extra para que nadie desaparezca
      slots[target ? target.id : 'EX' + Object.keys(slots).length] = p;
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
  if (!confirm('¿Reiniciar el draft? Se borran todos los picks (tu lista se conserva).')) return;
  state = { currentPick: 1, log: [], watch: state.watch };
  save();
  render();
}

function toggleWatch(id) {
  const i = state.watch.indexOf(id);
  if (i >= 0) state.watch.splice(i, 1); else state.watch.push(id);
  save();
  renderTable();
}

/* ---------- Simulación de rivales ----------
   Cada rival elige entre los mejores disponibles por ADP con algo de
   azar (como en un draft real) y respetando reglas básicas:
   nada de K/DST antes de la ronda 13, no un segundo QB o TE temprano,
   y asegura K y DST si se le acaban las rondas. */
const PICK_WEIGHTS = [0.42, 0.24, 0.13, 0.09, 0.06, 0.04, 0.02];

function cpuChoice(team) {
  const drafted = draftedMap();
  const round = roundOf(state.currentPick);
  const roundsLeft = ROUNDS - round + 1;
  const roster = Object.values(rosterFor(team)).filter(Boolean);
  const has = pos => roster.filter(p => p.pos === pos).length;
  const mustFill = ['K', 'DST'].filter(pos => has(pos) === 0);

  let pool = PLAYERS.filter(p => !drafted.has(p.id));
  if (mustFill.length >= roundsLeft) {
    pool = pool.filter(p => mustFill.includes(p.pos));
  } else {
    pool = pool.filter(p => {
      if ((p.pos === 'K' || p.pos === 'DST') && (round < 13 || has(p.pos) > 0)) return false;
      if (p.pos === 'QB' && (has('QB') >= 2 || (has('QB') >= 1 && round < 10))) return false;
      if (p.pos === 'TE' && (has('TE') >= 2 || (has('TE') >= 1 && round < 11))) return false;
      return true;
    });
  }
  const top = pool.slice(0, PICK_WEIGHTS.length);
  if (!top.length) return null;
  let r = Math.random() * PICK_WEIGHTS.slice(0, top.length).reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) {
    r -= PICK_WEIGHTS[i];
    if (r <= 0) return top[i];
  }
  return top[0];
}

function simulateToMyTurn() {
  let n = 0;
  while (!isOver() && teamOnClock(state.currentPick) !== MY_TEAM) {
    const team = teamOnClock(state.currentPick);
    const p = cpuChoice(team);
    if (!p) break;
    state.log.push({ pick: state.currentPick, team, playerId: p.id, sim: true });
    state.currentPick++;
    n++;
  }
  save();
  render();
  if (n) toast(isOver() ? `Se simularon ${n} picks. El draft terminó.` : `Se simularon ${n} picks. Te toca.`, !isOver());
  else toast('Ya es tu turno: elige a tu jugador primero.');
}

/* ---------- Disponibilidad en tu siguiente pick ----------
   Compara el lugar del jugador entre los disponibles con cuántos
   picks hay antes de tu siguiente turno. */
function availabilityMap() {
  const map = new Map();
  if (isOver()) return map;
  const mine = teamOnClock(state.currentPick) === MY_TEAM;
  const target = nextPickFor(MY_TEAM, state.currentPick + (mine ? 1 : 0));
  if (!target) return map;
  const before = target - state.currentPick; // picks que pasan antes de tu turno
  const drafted = draftedMap();
  PLAYERS.filter(p => !drafted.has(p.id) && p.pos !== 'K' && p.pos !== 'DST').forEach((p, idx) => {
    if (idx < before * 0.7) map.set(p.id, 'gone');
    else if (idx < before * 1.3) map.set(p.id, 'maybe');
    else map.set(p.id, 'likely');
  });
  return map;
}
const AVAIL_TEXT = { gone: 'Se va', maybe: 'En duda', likely: 'Llega' };

/* ---------- Exportar ---------- */
function exportCSV() {
  const slots = rosterFor(MY_TEAM);
  const picks = new Map(state.log.filter(l => l.team === MY_TEAM).map(l => [l.playerId, l.pick]));
  const rows = [['Slot', 'Jugador', 'Posicion', 'Equipo NFL', 'Bye', 'ADP', 'Pick']];
  ROSTER_SLOTS.forEach(s => {
    const p = slots[s.id];
    rows.push(p ? [s.label, p.name, p.pos, p.team, p.bye || '', p.rank, picks.get(p.id)] : [s.label, '', '', '', '', '', '']);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'mi-roster-2026.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Roster exportado');
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
  const roundsLeft = ROUNDS - round + 1;
  const lateNeeds = needs.K + needs.DST;
  const owned = pos => Object.values(slots).filter(p => p && p.pos === pos).length;
  const supply = tierSupply();
  const avail = availabilityMap();

  return PLAYERS
    .filter(p => !drafted.has(p.id))
    .filter(p => round >= 13 || (p.pos !== 'K' && p.pos !== 'DST')) // K y DST solo al final
    .map(p => {
      let score = 300 - p.rank;
      const need = needs[p.pos];
      let why = 'Mejor valor disponible';
      if (need > 0) { score += 15 * need; why = `Llena tu ${p.pos} titular`; }
      else if (FLEX_POS.includes(p.pos) && !slots.FLEX) { score += 8; why = 'Candidato para tu FLEX'; }
      const left = supply[p.pos]?.[p.tier] ?? 99;
      if (left <= 2 && (need > 0 || FLEX_POS.includes(p.pos))) {
        score += 10;
        why += left === 1 ? `. Es el último de su tier` : `. Solo quedan ${left} de su tier`;
      }
      if (avail.get(p.id) === 'gone') score += 4; // no va a regresar a tu siguiente pick
      // En liga de 1 QB y 1 TE, los suplentes valen poco
      if (p.pos === 'QB' && owned('QB') >= 1) { score -= owned('QB') >= 2 ? 200 : 40; why = 'QB suplente'; }
      if (p.pos === 'TE' && owned('TE') >= 1) { score -= owned('TE') >= 2 ? 200 : 25; why = 'TE suplente'; }
      if ((p.pos === 'K' || p.pos === 'DST') && need === 0) score -= 300;
      // Asegura K y DST antes de que se acaben las rondas
      if ((p.pos === 'K' || p.pos === 'DST') && need > 0 && roundsLeft <= lateNeeds + 1) {
        score += 300;
        why = `Quedan ${roundsLeft} rondas: asegura tu ${p.pos}`;
      }
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
    $('sbNext').innerHTML = next ? `#${next} <small>en ${gap} ${gap === 1 ? 'pick' : 'picks'}</small>` : 'Ya no tienes picks';
    sb.classList.toggle('is-mine', mine);
  }
  $('undoBtn').disabled = state.log.length === 0;
}

/* Cuántos jugadores quedan disponibles por posición y tier */
function tierSupply() {
  const drafted = draftedMap();
  const out = {};
  PLAYERS.forEach(p => {
    if (drafted.has(p.id)) return;
    out[p.pos] = out[p.pos] || {};
    out[p.pos][p.tier] = (out[p.pos][p.tier] || 0) + 1;
  });
  return out;
}

function renderSupply() {
  const supply = tierSupply();
  let html = '<thead><tr><th></th>' + [1, 2, 3, 4].map(t => `<th class="tier tier-${t}">T${t}</th>`).join('') + '</tr></thead><tbody>';
  ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
    html += `<tr><th>${posTag(pos)}</th>`;
    [1, 2, 3, 4].forEach(t => {
      const n = supply[pos]?.[t] || 0;
      const cls = n === 0 ? 'is-out' : n <= 2 ? 'is-low' : '';
      html += `<td class="${cls}">${n}</td>`;
    });
    html += '</tr>';
  });
  $('supply').innerHTML = html + '</tbody>';
}

function renderPosFilter() {
  const wrap = $('posFilter');
  const opts = ['ALL', ...POSITIONS, 'WATCH'];
  wrap.style.setProperty('--count', opts.length);
  wrap.innerHTML = '';
  opts.forEach(o => {
    const label = el('label');
    const text = o === 'ALL' ? 'Todos' : o === 'WATCH' ? 'Mi lista' : o;
    label.innerHTML = `<input type="radio" name="pos" value="${o}" ${o === ui.pos ? 'checked' : ''}><span>${text}</span>`;
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
    (ui.pos === 'ALL' || p.pos === ui.pos || (ui.pos === 'WATCH' && state.watch.includes(p.id))) &&
    (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
    (!hideTaken || !drafted.has(p.id))
  );
}

function renderTable() {
  const body = $('playerBody');
  const drafted = draftedMap();
  const rows = filteredPlayers();
  const mine = !isOver() && teamOnClock(state.currentPick) === MY_TEAM;
  const avail = availabilityMap();
  body.innerHTML = '';
  $('emptyState').hidden = rows.length > 0;
  $('emptyState').textContent = ui.pos === 'WATCH' && !state.watch.length
    ? 'Tu lista está vacía. Toca la estrella de un jugador para seguirlo.'
    : 'Nadie coincide con esa búsqueda. Prueba con otro nombre o cambia la posición.';

  const frag = document.createDocumentFragment();
  rows.forEach(p => {
    const d = drafted.get(p.id);
    const watched = state.watch.includes(p.id);
    const a = d ? null : avail.get(p.id);
    const tr = el('tr', d ? 'is-taken' : '');
    tr.innerHTML = `
      <td class="c-star"><button class="star${watched ? ' is-on' : ''}" aria-pressed="${watched}" aria-label="${watched ? 'Quitar de' : 'Agregar a'} tu lista: ${p.name}">★</button></td>
      <td class="c-rank">${p.rank}</td>
      <td><div class="p-name">${p.name}</div><div class="p-sub">${p.team}${d ? `, elegido por ${teamLabel(d.team)} en el pick ${d.pick}` : ''}</div></td>
      <td>${posTag(p.pos)}</td>
      <td class="c-num">${p.bye || '–'}</td>
      <td><span class="tier tier-${p.tier}">Tier ${p.tier}</span></td>
      <td class="c-avail">${a ? `<span class="avail avail-${a}">${AVAIL_TEXT[a]}</span>` : ''}</td>
      <td class="c-action"></td>`;
    tr.querySelector('.star').addEventListener('click', () => toggleWatch(p.id));
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
  const extras = Object.keys(slots).filter(k => k.startsWith('EX')).map(id => ({ id, label: 'Extra', bench: true }));
  [...ROSTER_SLOTS, ...extras].forEach(s => {
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
  renderSupply();
  renderLog();
  if (ui.view === 'grid') renderGrid();
  $('simBtn').disabled = isOver() || teamOnClock(state.currentPick) === MY_TEAM;
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
  $('simBtn').addEventListener('click', simulateToMyTurn);
  $('exportBtn').addEventListener('click', exportCSV);
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
