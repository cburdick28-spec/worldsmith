// DOM overlay: nations panel, chronicle, toolbar, tooltips and the possession HUD.
import { nations, game, capacity, nm } from './nations.js';
import { units } from './units.js';

const $ = id => document.getElementById(id);
const pending = [];
let ready = false;

export function log(html) {
  if (!ready) { pending.push(html); return; }
  const el = document.createElement('div');
  el.className = 'entry';
  el.innerHTML = `<span class="yr">Y${game.year}</span>${html}`;
  const box = $('chronicle-list');
  box.prepend(el);
  while (box.children.length > 60) box.lastChild.remove();
}

export function initUI(tools, onTool, onSpeed, onNew) {
  const bar = $('toolbar');
  for (const t of tools) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.id = t.id;
    b.innerHTML = `<span class="ic">${t.icon}</span><span class="k">${t.key}</span><span class="nm">${t.name}</span>`;
    b.title = `${t.name} (${t.key}): ${t.hint}`;
    b.onclick = () => onTool(t.id);
    bar.appendChild(b);
  }
  document.querySelectorAll('[data-speed]').forEach(b => { b.onclick = () => onSpeed(+b.dataset.speed); });
  $('new-world').onclick = onNew;
  $('begin').onclick = () => $('intro').classList.add('gone');
  ready = true;
  pending.splice(0).forEach(log);
}

export function setToolUI(tool) {
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.id === tool.id));
  $('hint').innerHTML = `<b>${tool.icon} ${tool.name}</b><br>${tool.hint}`;
}

export function setSpeedUI(s) {
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === s));
}

function relText(n) {
  const parts = [];
  if (n.enemies.length) parts.push(`<span class="war">⚔ at war with ${n.enemies.map(m => m.place).join(', ')}</span>`);
  if (n.allies.length) parts.push(`<span class="ally">🤝 allied with ${n.allies.map(m => m.place).join(', ')}</span>`);
  return parts.join('<br>') || '<span class="peace">at peace</span>';
}

export function updateUI() {
  $('year').textContent = `Year ${game.year}`;
  $('pop').textContent = `${units.length} souls`;
  const list = $('nations');
  const alive = nations.filter(n => n.alive);
  list.innerHTML = alive.map(n => {
    let soldiers = 0;
    for (const u of n.units) if (u.role === 'soldier') soldiers++;
    const k = n.king;
    return `<div class="nation" style="--c:${n.css}">
      <div class="nt">${n.name}</div>
      <div class="ns">${n.R.label} · founded Y${n.founded}</div>
      <div class="king">👑 ${k ? `${n.R.ruler} ${k.name}, age ${k.age}` : '<i>no ruler</i>'}</div>
      <div class="stats"><span title="Population / housing">👥 ${n.units.size}/${capacity(n)}</span><span title="Soldiers">🗡 ${soldiers}</span><span title="Houses">🏠 ${n.houses.length}</span><span title="Wood">🪵 ${n.wood}</span></div>
      <div class="rel">${relText(n)}</div>
    </div>`;
  }).join('') || '<div class="nation"><i>No nations remain. Use a spawn tool to begin anew.</i></div>';
}

export function showTip(x, y, html) {
  const t = $('tip');
  t.innerHTML = html;
  t.style.transform = `translate(${x + 16}px, ${y + 16}px)`;
  t.style.display = 'block';
}
export function hideTip() { $('tip').style.display = 'none'; }

const ROLE = { villager: 'Villager', soldier: 'Soldier', king: 'Ruler' };
const STATE = { idle: 'resting', goto: 'wandering', flee: 'fleeing', chop: 'chopping wood', build: 'building a house', fight: 'fighting', siege: 'besieging a house' };

export function unitHTML(u) {
  return `<b>${u.name}</b> of ${nm(u.nation)}<br>${u.role === 'king' ? u.nation.R.ruler : ROLE[u.role]} · age ${u.age} · ${Math.max(0, Math.ceil(u.hp))}/${u.maxHp} hp<br><span class="dim">${u.held ? 'in your grasp' : u.flying ? 'flying!' : STATE[u.state] || u.state}${u.kills ? ` · ${u.kills} kills` : ''}</span>`;
}

export function inspect(html) {
  $('inspect').innerHTML = html;
  $('inspect').style.display = html ? 'block' : 'none';
}

export function showPossess(u) {
  $('possess').style.display = 'block';
  $('intro').classList.add('gone');
  updatePossess(u);
}
export function updatePossess(u) {
  $('poss-name').innerHTML = `${u.name} of ${nm(u.nation)}`;
  $('poss-hp').style.width = `${Math.max(0, u.hp / u.maxHp) * 100}%`;
}
export function hidePossess() { $('possess').style.display = 'none'; }

export function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2200);
}
