'use strict';

const TILE = 48;
const COLS = 70;
const ROWS = 46;
const ISO_W = 72;
const ISO_H = 38;
const TICK_MS = 500;
const REACH = 5;
const DRILL_TICKS = 3;
const DRILL_BUFFER_CAP = 6;
const PLAYER_SPEED = TILE * 4.4;
const MINE_COOLDOWN = 220;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.7;
const HEIGHT = { drill: 30, assembler: 34, chest: 22, inserter: 18, belt: 7 };

const DIRS = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 }
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const DIR_ORDER = ['up', 'right', 'down', 'left'];

const RESOURCE_COLOR = { iron: '#9aa4d6', copper: '#e2985a' };
const GROUND_COLORS = ['#1a2233', '#182031', '#1c2536'];
const ITEM_COLOR = {
  iron_ore: '#9aa4d6', copper_ore: '#e2985a',
  iron_plate: '#d7dbf5', copper_plate: '#f4c48c',
  gear: '#eef1fa', circuit: '#8be6cf'
};
const ITEM_LABEL = {
  iron_ore: 'Minerale di ferro', copper_ore: 'Minerale di rame',
  iron_plate: 'Piastra di ferro', copper_plate: 'Piastra di rame',
  gear: 'Ingranaggio', circuit: 'Circuito elettronico'
};

const RECIPES = {
  smelt_iron: { name: 'Fusione: Piastra di ferro', input: { iron_ore: 1 }, output: { iron_plate: 1 }, ticks: 2 },
  smelt_copper: { name: 'Fusione: Piastra di rame', input: { copper_ore: 1 }, output: { copper_plate: 1 }, ticks: 2 },
  gear: { name: 'Ingranaggio', input: { iron_plate: 2 }, output: { gear: 1 }, ticks: 3 },
  circuit: { name: 'Circuito elettronico', input: { iron_plate: 1, copper_plate: 1 }, output: { circuit: 1 }, ticks: 4 }
};
const HAND_RECIPES = ['gear', 'circuit'];

const $ = selector => document.querySelector(selector);
const canvas = $('#board');
const ctx = canvas.getContext('2d');
const minimap = $('#minimap');
const mctx = minimap.getContext('2d');

function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpPt(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }

/* ---------- Iso projection ---------- */
function isoProject(worldX, worldY) {
  const tx = worldX / TILE, ty = worldY / TILE;
  return { x: (tx - ty) * (ISO_W / 2), y: (tx + ty) * (ISO_H / 2) };
}
function isoUnproject(isoX, isoY) {
  const tx = isoX / ISO_W + isoY / ISO_H;
  const ty = isoY / ISO_H - isoX / ISO_W;
  return { c: Math.floor(tx), r: Math.floor(ty) };
}
function tileTop(r, c) { return isoProject(c * TILE, r * TILE); }
function tileCorners(r, c) {
  return {
    n: tileTop(r, c),
    e: tileTop(r, c + 1),
    s: tileTop(r + 1, c + 1),
    w: tileTop(r + 1, c)
  };
}
function tileCenterIso(r, c) { return isoProject(c * TILE + TILE / 2, r * TILE + TILE / 2); }

/* ---------- World ---------- */
function makeTiles() {
  const tiles = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ resource: null, amount: 0, decor: null, ground: 0, prop: false })));
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      tiles[r][c].ground = Math.floor(Math.random() * GROUND_COLORS.length);
      tiles[r][c].prop = Math.random() < 0.035;
    }
  }
  function patch(kind, cr, cc, radius, amount) {
    for (let r = cr - radius; r <= cr + radius; r += 1) {
      for (let c = cc - radius; c <= cc + radius; c += 1) {
        if (!inBounds(r, c)) continue;
        if (Math.hypot(r - cr, c - cc) <= radius + Math.random() * 0.6) {
          const decor = Array.from({ length: 4 + Math.floor(Math.random() * 3) }, () => ({
            ftx: (Math.random() - 0.5) * 0.6,
            fty: (Math.random() - 0.5) * 0.6,
            r: 3 + Math.random() * 3.5
          }));
          tiles[r][c] = { resource: kind, amount, decor, ground: tiles[r][c].ground, prop: false };
        }
      }
    }
  }
  patch('iron', 8, 10, 3, 550); patch('iron', 34, 58, 3, 550); patch('iron', 12, 45, 2, 400); patch('iron', 38, 14, 2, 420);
  patch('copper', 8, 58, 3, 500); patch('copper', 34, 10, 3, 500); patch('copper', 24, 34, 2, 400); patch('copper', 6, 30, 2, 380);
  return tiles;
}

const world = { tiles: makeTiles(), buildings: Array.from({ length: ROWS }, () => Array(COLS).fill(null)) };

const player = { x: 35 * TILE, y: 23 * TILE, dir: 'down', moving: false, inventory: {}, lastMine: 0 };
function playerTileR() { return Math.floor(player.y / TILE); }
function playerTileC() { return Math.floor(player.x / TILE); }

const worldIsoBounds = (() => {
  const pts = [isoProject(0, 0), isoProject(COLS * TILE, 0), isoProject(0, ROWS * TILE), isoProject(COLS * TILE, ROWS * TILE)];
  return {
    minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y))
  };
})();

const camera = { x: 0, y: 0, zoom: 1 };
const state = {
  tool: 'drill', placeDir: 'down', hover: null, currentTick: 0,
  achieved: new Set(), modalTarget: null,
  soundEnabled: localStorage.getItem('factory-sound') !== 'off'
};

function addItem(bag, kind, qty = 1) { bag[kind] = (bag[kind] || 0) + qty; }
function takeItem(bag, kind, qty = 1) {
  if ((bag[kind] || 0) < qty) return false;
  bag[kind] -= qty;
  if (bag[kind] <= 0) delete bag[kind];
  return true;
}
function hasAll(bag, needs) { return Object.entries(needs).every(([kind, qty]) => (bag[kind] || 0) >= qty); }
function takeAll(bag, needs) { Object.entries(needs).forEach(([kind, qty]) => takeItem(bag, kind, qty)); }
function firstKind(bag) { return Object.keys(bag).find(k => bag[k] > 0) || null; }

/* ---------- Sound ---------- */
let audioContext = null;
function ensureAudio() {
  if (!state.soundEnabled) return null;
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}
function tone(frequency, duration = .12, type = 'sine', volume = .05, delay = 0) {
  const context = ensureAudio();
  if (!context) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  osc.type = type; osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  osc.connect(gain); gain.connect(context.destination); osc.start(start); osc.stop(start + duration);
}
function playSound(name) {
  if (name === 'mine') tone(320, .07, 'triangle', .04);
  if (name === 'place') tone(210, .08, 'square', .035);
  if (name === 'remove') tone(140, .1, 'sawtooth', .03);
  if (name === 'craft') [523, 659, 784].forEach((f, i) => tone(f, .12, 'sine', .035, i * .06));
  if (name === 'pickup') tone(700, .08, 'sine', .04);
  if (name === 'error') tone(120, .14, 'sawtooth', .035);
}

function toast(message) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function building(r, c) { return inBounds(r, c) ? world.buildings[r][c] : null; }

/* ---------- Placement ---------- */
function canPlace(tool, r, c) {
  if (!inBounds(r, c)) return { ok: false, reason: 'Fuori dai confini.' };
  const dist = Math.max(Math.abs(r - playerTileR()), Math.abs(c - playerTileC()));
  if (dist > REACH) return { ok: false, reason: 'Troppo lontano.' };
  const existing = world.buildings[r][c];
  if (tool === 'remove') return existing ? { ok: true } : { ok: false, reason: 'Niente da rimuovere.' };
  if (existing) return { ok: false, reason: 'Occupato.' };
  if (tool === 'drill' && !world.tiles[r][c].resource) return { ok: false, reason: 'Serve un giacimento.' };
  return { ok: true };
}

function placeBuilding(r, c) {
  const check = canPlace(state.tool, r, c);
  if (!check.ok) { if (check.reason) toast(check.reason); playSound('error'); return; }

  if (state.tool === 'remove') { world.buildings[r][c] = null; playSound('remove'); return; }
  if (state.tool === 'drill') {
    world.buildings[r][c] = { type: 'drill', dir: state.placeDir, progress: 0, buffer: {} };
    markAchieved('drill');
  } else if (state.tool === 'belt') {
    world.buildings[r][c] = { type: 'belt', dir: state.placeDir, item: null };
    markAchieved('belt');
  } else if (state.tool === 'inserter') {
    world.buildings[r][c] = { type: 'inserter', dir: state.placeDir, holding: null };
    markAchieved('inserter');
  } else if (state.tool === 'assembler') {
    world.buildings[r][c] = { type: 'assembler', recipe: null, input: {}, output: {}, progress: 0 };
    markAchieved('assembler');
  } else if (state.tool === 'chest') {
    world.buildings[r][c] = { type: 'chest', storage: {} };
    markAchieved('chest');
  }
  playSound('place');
}
function markAchieved(id) { state.achieved.add(id); }

/* ---------- Input ---------- */
function tileFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const sx = (event.clientX - rect.left) * (canvas.width / rect.width);
  const sy = (event.clientY - rect.top) * (canvas.height / rect.height);
  const isoX = sx / camera.zoom + camera.x;
  const isoY = sy / camera.zoom + camera.y;
  return isoUnproject(isoX, isoY);
}

canvas.addEventListener('mousemove', event => { state.hover = tileFromEvent(event); });
canvas.addEventListener('mouseleave', () => { state.hover = null; });
canvas.addEventListener('click', event => {
  const { r, c } = tileFromEvent(event);
  const target = building(r, c);
  if (state.tool !== 'remove' && target && target.type === 'assembler') return openRecipeModal(r, c);
  placeBuilding(r, c);
});
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  const { r, c } = tileFromEvent(event);
  const previousTool = state.tool;
  state.tool = 'remove';
  placeBuilding(r, c);
  state.tool = previousTool;
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  camera.zoom = clamp(camera.zoom - Math.sign(event.deltaY) * 0.1, ZOOM_MIN, ZOOM_MAX);
}, { passive: false });

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.hotbar-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
}
document.querySelectorAll('.hotbar-btn').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

const keys = new Set();
const TOOL_KEYS = { 1: 'drill', 2: 'belt', 3: 'inserter', 4: 'assembler', 5: 'chest', 6: 'remove' };
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  keys.add(key);
  if (key === 'r') rotatePlacement();
  if (key === 'e') interact();
  if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

function rotatePlacement() {
  const idx = DIR_ORDER.indexOf(state.placeDir);
  state.placeDir = DIR_ORDER[(idx + 1) % DIR_ORDER.length];
}

/* ---------- Player & camera ---------- */
function updatePlayer(dt) {
  let dx = 0, dy = 0;
  if (keys.has('w') || keys.has('arrowup')) dy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dy += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  player.moving = Boolean(dx || dy);
  if (player.moving) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    player.x = clamp(player.x + dx * PLAYER_SPEED * dt, TILE * 0.35, COLS * TILE - TILE * 0.35);
    player.y = clamp(player.y + dy * PLAYER_SPEED * dt, TILE * 0.35, ROWS * TILE - TILE * 0.35);
    player.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
}

function clampAxis(target, lo, hi) { return lo <= hi ? clamp(target, lo, hi) : (lo + hi) / 2; }
function updateCamera() {
  const viewW = canvas.width / camera.zoom;
  const viewH = canvas.height / camera.zoom;
  const p = isoProject(player.x, player.y);
  const margin = ISO_W * 3;
  camera.x = clampAxis(p.x - viewW / 2, worldIsoBounds.minX - margin, worldIsoBounds.maxX - viewW + margin);
  camera.y = clampAxis(p.y - viewH / 2, worldIsoBounds.minY - margin, worldIsoBounds.maxY - viewH + margin);
}

function facingTile() {
  const d = DIRS[player.dir];
  return { r: playerTileR() + d.dr, c: playerTileC() + d.dc };
}

/* ---------- Interaction ---------- */
function interact() {
  const now = performance.now();
  const { r, c } = facingTile();
  if (!inBounds(r, c)) return;
  const target = world.buildings[r][c];
  if (target && target.type === 'chest') {
    const kinds = Object.keys(target.storage);
    if (!kinds.length) return toast('La cassa è vuota.');
    kinds.forEach(kind => { addItem(player.inventory, kind, target.storage[kind]); target.storage[kind] = 0; });
    renderInventory(); playSound('pickup');
    return toast('Hai ritirato il contenuto della cassa.');
  }
  if (target && target.type === 'assembler') return openRecipeModal(r, c);
  const tile = world.tiles[r][c];
  if (tile.resource && tile.amount > 0) {
    if (now - player.lastMine < MINE_COOLDOWN) return;
    player.lastMine = now;
    tile.amount -= 1;
    addItem(player.inventory, `${tile.resource}_ore`, 1);
    if (tile.amount <= 0) tile.resource = null;
    if ((player.inventory.iron_ore || 0) >= 5) markAchieved('mine5');
    renderInventory(); playSound('mine');
    return;
  }
  toast('Niente da fare qui.');
}

function openRecipeModal(r, c) {
  state.modalTarget = { r, c };
  const list = $('#recipe-list');
  list.innerHTML = '';
  Object.entries(RECIPES).forEach(([id, recipe]) => {
    const btn = document.createElement('button');
    const inputText = Object.entries(recipe.input).map(([k, v]) => `${v}x ${ITEM_LABEL[k]}`).join(' + ');
    const outputText = Object.entries(recipe.output).map(([k, v]) => `${v}x ${ITEM_LABEL[k]}`).join(' + ');
    btn.innerHTML = `${recipe.name}<small>${inputText} → ${outputText}</small>`;
    btn.addEventListener('click', () => {
      world.buildings[r][c].recipe = id;
      world.buildings[r][c].progress = 0;
      closeRecipeModal();
      toast(`Ricetta impostata: ${recipe.name}`);
    });
    list.appendChild(btn);
  });
  $('#recipe-modal').classList.remove('hidden');
}
function closeRecipeModal() { $('#recipe-modal').classList.add('hidden'); state.modalTarget = null; }
$('#recipe-close').addEventListener('click', closeRecipeModal);

$('#sound-toggle').addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('factory-sound', state.soundEnabled ? 'on' : 'off');
  $('#sound-toggle').textContent = state.soundEnabled ? '♪' : '×';
  if (state.soundEnabled) playSound('pickup');
});
$('#sound-toggle').textContent = state.soundEnabled ? '♪' : '×';

/* ---------- UI panels ---------- */
function renderInventory() {
  const list = $('#inventory');
  const entries = Object.entries(player.inventory).filter(([, qty]) => qty > 0);
  list.innerHTML = entries.length
    ? entries.map(([kind, qty]) => `<li><span class="swatch" style="background:${ITEM_COLOR[kind]}"></span>${ITEM_LABEL[kind] || kind}<b>${qty}</b></li>`).join('')
    : '<li class="empty">Inventario vuoto. Vai a minare!</li>';
}
function renderHandCraft() {
  const host = $('#hand-craft');
  host.innerHTML = '';
  HAND_RECIPES.forEach(id => {
    const recipe = RECIPES[id];
    const btn = document.createElement('button');
    const inputText = Object.entries(recipe.input).map(([k, v]) => `${v}x ${ITEM_LABEL[k]}`).join(' + ');
    btn.innerHTML = `${recipe.name}<small>${inputText}</small>`;
    btn.disabled = !hasAll(player.inventory, recipe.input);
    btn.addEventListener('click', () => {
      if (!hasAll(player.inventory, recipe.input)) return;
      takeAll(player.inventory, recipe.input);
      Object.entries(recipe.output).forEach(([kind, qty]) => addItem(player.inventory, kind, qty));
      if (id === 'gear') markAchieved('gear');
      playSound('craft');
      renderInventory(); renderHandCraft();
    });
    host.appendChild(btn);
  });
}

const OBJECTIVES = [
  { id: 'mine5', text: 'Estrai a mano almeno 5 minerale di ferro' },
  { id: 'drill', text: 'Piazza un Trapano Minerario su un giacimento' },
  { id: 'belt', text: 'Piazza un Nastro trasportatore' },
  { id: 'inserter', text: 'Piazza un Inserter per collegare macchine e nastri' },
  { id: 'assembler', text: 'Piazza un Assemblatore e imposta una ricetta' },
  { id: 'chest', text: 'Piazza una Cassa e usa un Inserter per riempirla' },
  { id: 'gear', text: 'Produci un Ingranaggio' }
];
function renderObjectives() {
  const list = $('#objectives');
  list.innerHTML = OBJECTIVES.map(objective => {
    const done = state.achieved.has(objective.id);
    return `<li class="${done ? 'done' : ''}"><span>${done ? '✓' : '○'}</span>${objective.text}</li>`;
  }).join('');
}

/* ---------- Simulation ---------- */
function tryTakeFrom(r, c) {
  const b = building(r, c);
  if (!b) return null;
  if (b.type === 'belt' && b.item) { const kind = b.item.kind; b.item = null; return kind; }
  if (b.type === 'drill') { const kind = firstKind(b.buffer); if (kind && takeItem(b.buffer, kind, 1)) return kind; return null; }
  if (b.type === 'assembler') { const kind = firstKind(b.output); if (kind) { b.output[kind] -= 1; return kind; } return null; }
  if (b.type === 'chest') { const kind = firstKind(b.storage); if (kind) { b.storage[kind] -= 1; return kind; } return null; }
  return null;
}
function tryPutInto(r, c, kind) {
  const b = building(r, c);
  if (!b) return false;
  if (b.type === 'belt') { if (b.item) return false; b.item = { kind, fromR: r, fromC: c, movedTick: state.currentTick }; return true; }
  if (b.type === 'assembler') {
    if (!b.recipe) return false;
    const need = RECIPES[b.recipe].input;
    if (!(kind in need) || (b.input[kind] || 0) >= need[kind] * 3) return false;
    addItem(b.input, kind, 1); return true;
  }
  if (b.type === 'chest') { addItem(b.storage, kind, 1); return true; }
  return false;
}

function tick() {
  state.currentTick += 1;

  // Belts move items forward
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'belt' || !b.item || b.item.movedTick === state.currentTick) continue;
      const d = DIRS[b.dir];
      const nr = r + d.dr, nc = c + d.dc;
      if (!inBounds(nr, nc)) continue;
      const target = world.buildings[nr][nc];
      if (target && target.type === 'belt' && !target.item) {
        target.item = { kind: b.item.kind, fromR: r, fromC: c, movedTick: state.currentTick };
        b.item = null;
      }
    }
  }

  // Drills mine into their own buffer, then push toward their facing neighbor
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'drill') continue;
      const tile = world.tiles[r][c];
      const bufTotal = Object.values(b.buffer).reduce((s, n) => s + n, 0);
      if (tile.resource && tile.amount > 0 && bufTotal < DRILL_BUFFER_CAP) {
        b.progress += 1;
        if (b.progress >= DRILL_TICKS) {
          b.progress = 0;
          addItem(b.buffer, `${tile.resource}_ore`, 1);
          tile.amount -= 1;
          if (tile.amount <= 0) tile.resource = null;
        }
      }
      const kind = firstKind(b.buffer);
      if (kind) {
        const d = DIRS[b.dir];
        const nr = r + d.dr, nc = c + d.dc;
        if (tryPutInto(nr, nc, kind)) takeItem(b.buffer, kind, 1);
      }
    }
  }

  // Inserters: pick from the tile behind them, drop onto the tile they face
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'inserter') continue;
      const dropDir = DIRS[b.dir];
      const pickDir = DIRS[OPPOSITE[b.dir]];
      const dropR = r + dropDir.dr, dropC = c + dropDir.dc;
      const pickR = r + pickDir.dr, pickC = c + pickDir.dc;
      if (!b.holding) {
        const kind = tryTakeFrom(pickR, pickC);
        if (kind) b.holding = kind;
      } else if (tryPutInto(dropR, dropC, b.holding)) {
        b.holding = null;
      }
    }
  }

  // Assemblers craft from their input buffer (filled only by inserters)
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'assembler' || !b.recipe) continue;
      const recipe = RECIPES[b.recipe];
      if (b.progress === 0 && !hasAll(b.input, recipe.input)) continue;
      if (b.progress === 0) takeAll(b.input, recipe.input);
      b.progress += 1;
      if (b.progress >= recipe.ticks) {
        b.progress = 0;
        Object.entries(recipe.output).forEach(([kind, qty]) => addItem(b.output, kind, qty));
        b.pulse = 1;
      }
    }
  }

  renderObjectives();
  renderHandCraft();
}

/* ---------- Rendering ---------- */
function shade(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawDiamond(pts, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts.n.x, pts.n.y); ctx.lineTo(pts.e.x, pts.e.y); ctx.lineTo(pts.s.x, pts.s.y); ctx.lineTo(pts.w.x, pts.w.y);
  ctx.closePath(); ctx.fill();
}

function drawGround(r, c) {
  const tile = world.tiles[r][c];
  const pts = tileCorners(r, c);
  let color = GROUND_COLORS[tile.ground];
  if (tile.resource) color = shade(RESOURCE_COLOR[tile.resource], 0.34);
  drawDiamond(pts, color);
  if (tile.resource) {
    const alpha = clamp(tile.amount / 500, 0.35, 1);
    (tile.decor || []).forEach(dot => {
      const p = isoProject(c * TILE + TILE / 2 + dot.ftx * TILE, r * TILE + TILE / 2 + dot.fty * TILE);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, dot.r, dot.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(RESOURCE_COLOR[tile.resource], alpha);
      ctx.fill();
    });
  } else if (tile.prop) {
    const p = tileCenterIso(r, c);
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 3, 6, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 5, 3.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3a4256'; ctx.fill();
  }
}

function drawBlock(r, c, h, topColor) {
  const base = tileCorners(r, c);
  const lift = p => ({ x: p.x, y: p.y - h });
  const n = lift(base.n), e = lift(base.e), s = lift(base.s), w = lift(base.w);
  // right face (e-s)
  ctx.beginPath(); ctx.moveTo(base.e.x, base.e.y); ctx.lineTo(base.s.x, base.s.y); ctx.lineTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.closePath();
  ctx.fillStyle = shade(topColor, 0.62); ctx.fill();
  // front face (s-w)
  ctx.beginPath(); ctx.moveTo(base.s.x, base.s.y); ctx.lineTo(base.w.x, base.w.y); ctx.lineTo(w.x, w.y); ctx.lineTo(s.x, s.y); ctx.closePath();
  ctx.fillStyle = shade(topColor, 0.46); ctx.fill();
  // top face
  drawDiamond({ n, e, s, w }, shade(topColor, 1));
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(e.x, e.y); ctx.lineTo(s.x, s.y); ctx.lineTo(w.x, w.y); ctx.closePath(); ctx.stroke();
}
function topCentroid(r, c, h) {
  const p = tileCenterIso(r, c);
  return { x: p.x, y: p.y - h };
}

let lastTickAt = 0;
function beltItemScreenPos(item, r, c, now) {
  const rest = topCentroid(r, c, HEIGHT.belt);
  if (item.movedTick !== state.currentTick) return rest;
  const t = clamp((now - lastTickAt) / TICK_MS, 0, 1);
  const from = topCentroid(item.fromR, item.fromC, HEIGHT.belt);
  return lerpPt(from, rest, t);
}

function drawItemMarker(pos, kind, radius = 6.5) {
  ctx.beginPath(); ctx.ellipse(pos.x, pos.y + radius * 0.7, radius, radius * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
  ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = ITEM_COLOR[kind] || '#fff'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.4; ctx.stroke();
}

function drawBuilding(r, c, b, now) {
  if (b.type === 'belt') {
    drawBlock(r, c, HEIGHT.belt, '#3a4460');
    const from = topCentroid(r - DIRS[b.dir].dr, c - DIRS[b.dir].dc, HEIGHT.belt);
    const to = topCentroid(r, c, HEIGHT.belt);
    const center = topCentroid(r, c, HEIGHT.belt);
    const dx = to.x - (from.x), dy = to.y - (from.y);
    const ang = Math.atan2(dy, dx);
    const t = (now / 320) % 1;
    for (let i = 0; i < 2; i += 1) {
      const off = ((t + i * 0.5) % 1) - 0.5;
      const px = center.x + Math.cos(ang) * off * ISO_W * 0.28;
      const py = center.y + Math.sin(ang) * off * ISO_H * 0.28;
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
    }
    if (b.item) drawItemMarker(beltItemScreenPos(b.item, r, c, now), b.item.kind, 6);
    return;
  }
  if (b.type === 'drill') {
    drawBlock(r, c, HEIGHT.drill, '#4a5470');
    const top = topCentroid(r, c, HEIGHT.drill);
    const bob = Math.abs(Math.sin(now / 140)) * 4;
    ctx.strokeStyle = '#ffb35c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(top.x, top.y - 14 - bob); ctx.lineTo(top.x, top.y - 4); ctx.stroke();
    ctx.beginPath(); ctx.arc(top.x, top.y - 4, 3, 0, Math.PI * 2); ctx.fillStyle = '#ffb35c'; ctx.fill();
    const barW = 26;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(top.x - barW / 2, top.y + 10, barW, 4);
    ctx.fillStyle = '#ffb35c'; ctx.fillRect(top.x - barW / 2, top.y + 10, barW * (b.progress / DRILL_TICKS), 4);
    return;
  }
  if (b.type === 'inserter') {
    drawBlock(r, c, HEIGHT.inserter, '#4b5568');
    const pivot = topCentroid(r, c, HEIGHT.inserter);
    const dropTile = topCentroid(r + DIRS[b.dir].dr, c + DIRS[b.dir].dc, HEIGHT.inserter * 0.4);
    const pickTile = topCentroid(r - DIRS[b.dir].dr, c - DIRS[b.dir].dc, HEIGHT.inserter * 0.4);
    const t = clamp((now - lastTickAt) / TICK_MS, 0, 1);
    const claw = b.holding ? lerpPt(pickTile, dropTile, t) : lerpPt(dropTile, pickTile, t);
    ctx.strokeStyle = '#dfe4ee'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y - 6); ctx.lineTo(claw.x, claw.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(pivot.x, pivot.y - 6, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#dfe4ee'; ctx.fill();
    if (b.holding) drawItemMarker(claw, b.holding, 5.5);
    else { ctx.beginPath(); ctx.arc(claw.x, claw.y, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(223,228,238,.6)'; ctx.fill(); }
    return;
  }
  if (b.type === 'assembler') {
    if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - 0.05);
    drawBlock(r, c, HEIGHT.assembler, b.recipe ? shade('#8b7cf6', 0.9 + (b.pulse || 0) * 0.3) : '#454d68');
    const top = topCentroid(r, c, HEIGHT.assembler);
    ctx.save(); ctx.translate(top.x, top.y - 6); ctx.rotate((now / 500) % (Math.PI * 2));
    ctx.strokeStyle = '#eef1fa'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 1.5); ctx.stroke();
    ctx.restore();
    if (b.recipe) {
      const rec = RECIPES[b.recipe];
      const barW = 28;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(top.x - barW / 2, top.y + 12, barW, 4);
      ctx.fillStyle = '#55d6be'; ctx.fillRect(top.x - barW / 2, top.y + 12, barW * (b.progress / rec.ticks), 4);
    }
    return;
  }
  if (b.type === 'chest') {
    drawBlock(r, c, HEIGHT.chest, '#7a5730');
    const top = topCentroid(r, c, HEIGHT.chest);
    const total = Object.values(b.storage).reduce((s, n) => s + n, 0);
    if (total > 0) {
      ctx.fillStyle = '#ffdb7a'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(total), top.x, top.y + 4);
    }
  }
}

function drawGhost(now) {
  if (!state.hover) return;
  const { r, c } = state.hover;
  if (!inBounds(r, c)) return;
  const check = canPlace(state.tool, r, c);
  const pts = tileCorners(r, c);
  ctx.save();
  ctx.globalAlpha = 0.6 + Math.sin(now / 220) * 0.08;
  ctx.strokeStyle = check.ok ? 'rgba(139,124,246,.9)' : 'rgba(255,93,115,.85)';
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(pts.n.x, pts.n.y); ctx.lineTo(pts.e.x, pts.e.y); ctx.lineTo(pts.s.x, pts.s.y); ctx.lineTo(pts.w.x, pts.w.y); ctx.closePath(); ctx.stroke();
  if (check.ok && state.tool !== 'remove') {
    ctx.fillStyle = 'rgba(139,124,246,.14)';
    ctx.beginPath(); ctx.moveTo(pts.n.x, pts.n.y); ctx.lineTo(pts.e.x, pts.e.y); ctx.lineTo(pts.s.x, pts.s.y); ctx.lineTo(pts.w.x, pts.w.y); ctx.closePath(); ctx.fill();
    if (['belt', 'drill', 'inserter'].includes(state.tool)) {
      const center = tileCenterIso(r, c);
      const dst = topCentroid(r + DIRS[state.placeDir].dr, c + DIRS[state.placeDir].dc, 0);
      const ang = Math.atan2(dst.y - center.y, dst.x - center.x);
      ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-5, -7); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawPlayer(now) {
  const ground = isoProject(player.x, player.y);
  const bob = player.moving ? Math.abs(Math.sin(now / 110)) * 3 : 0;
  ctx.beginPath(); ctx.ellipse(ground.x, ground.y + 4, 11, 5.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fill();
  const py = ground.y - 16 - bob;
  const grad = ctx.createRadialGradient(ground.x - 3, py - 3, 1, ground.x, py, 12);
  grad.addColorStop(0, '#fff1c4'); grad.addColorStop(1, '#ffb35c');
  ctx.beginPath(); ctx.arc(ground.x, py, 11, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = '#151d2d'; ctx.lineWidth = 2; ctx.stroke();
  const facing = topCentroid(playerTileR() + DIRS[player.dir].dr, playerTileC() + DIRS[player.dir].dc, 0);
  const ang = Math.atan2(facing.y - ground.y, facing.x - ground.x);
  ctx.beginPath();
  ctx.moveTo(ground.x + Math.cos(ang) * 15, py + Math.sin(ang) * 15);
  ctx.lineTo(ground.x + Math.cos(ang + 2.5) * 6, py + Math.sin(ang + 2.5) * 6);
  ctx.lineTo(ground.x + Math.cos(ang - 2.5) * 6, py + Math.sin(ang - 2.5) * 6);
  ctx.closePath(); ctx.fillStyle = '#ff5d73'; ctx.fill();
}

function visibleTileRange() {
  const viewW = canvas.width / camera.zoom, viewH = canvas.height / camera.zoom;
  const corners = [
    isoUnproject(camera.x, camera.y),
    isoUnproject(camera.x + viewW, camera.y),
    isoUnproject(camera.x, camera.y + viewH),
    isoUnproject(camera.x + viewW, camera.y + viewH)
  ];
  const margin = 2;
  return {
    r0: clamp(Math.min(...corners.map(p => p.r)) - margin, 0, ROWS),
    r1: clamp(Math.max(...corners.map(p => p.r)) + margin, 0, ROWS),
    c0: clamp(Math.min(...corners.map(p => p.c)) - margin, 0, COLS),
    c1: clamp(Math.max(...corners.map(p => p.c)) + margin, 0, COLS)
  };
}

function draw(now) {
  ctx.fillStyle = '#080d16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  const { r0, r1, c0, c1 } = visibleTileRange();
  for (let r = r0; r < r1; r += 1) for (let c = c0; c < c1; c += 1) drawGround(r, c);

  const sprites = [];
  for (let r = r0; r < r1; r += 1) {
    for (let c = c0; c < c1; c += 1) {
      const b = world.buildings[r][c];
      if (b) sprites.push({ depth: r + c, draw: () => drawBuilding(r, c, b, now) });
    }
  }
  sprites.push({ depth: playerTileR() + playerTileC() + 0.5, draw: () => drawPlayer(now) });
  sprites.sort((a, b) => a.depth - b.depth);
  sprites.forEach(sprite => sprite.draw());

  drawGhost(now);
  ctx.restore();
}

function drawMinimap() {
  const w = minimap.width, h = minimap.height;
  mctx.fillStyle = '#0a101b'; mctx.fillRect(0, 0, w, h);
  const sx = w / COLS, sy = h / ROWS;
  for (let r = 0; r < ROWS; r += 2) {
    for (let c = 0; c < COLS; c += 2) {
      const tile = world.tiles[r][c];
      if (tile.resource) { mctx.fillStyle = RESOURCE_COLOR[tile.resource]; mctx.fillRect(c * sx, r * sy, sx * 2, sy * 2); }
      const bld = world.buildings[r][c];
      if (bld) { mctx.fillStyle = 'rgba(139,124,246,.9)'; mctx.fillRect(c * sx, r * sy, sx * 2, sy * 2); }
    }
  }
  const { r0, r1, c0, c1 } = visibleTileRange();
  mctx.strokeStyle = 'rgba(255,255,255,.7)'; mctx.lineWidth = 1;
  mctx.strokeRect(c0 * sx, r0 * sy, (c1 - c0) * sx, (r1 - r0) * sy);
  mctx.fillStyle = '#ffdb7a';
  mctx.beginPath(); mctx.arc(playerTileC() * sx, playerTileR() * sy, 2.5, 0, Math.PI * 2); mctx.fill();
}

let lastFrame = 0;
let lastMinimapAt = 0;
function loop(timestamp) {
  const dt = Math.min(0.05, (timestamp - (lastFrame || timestamp)) / 1000);
  lastFrame = timestamp;
  updatePlayer(dt);
  updateCamera();
  if (timestamp - lastTickAt >= TICK_MS) { lastTickAt = timestamp; tick(); }
  draw(timestamp);
  if (timestamp - lastMinimapAt >= 200) { lastMinimapAt = timestamp; drawMinimap(); }
  requestAnimationFrame(loop);
}

renderInventory();
renderHandCraft();
renderObjectives();
requestAnimationFrame(loop);
