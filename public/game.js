'use strict';

const TILE = 32;
const COLS = 26;
const ROWS = 18;
const TICK_MS = 500;
const REACH = 5;
const DRILL_TICKS = 3;
const MOVE_COOLDOWN = 140;
const MINE_COOLDOWN = 220;

const DIRS = {
  up: { dr: -1, dc: 0, angle: -Math.PI / 2 },
  down: { dr: 1, dc: 0, angle: Math.PI / 2 },
  left: { dr: 0, dc: -1, angle: Math.PI },
  right: { dr: 0, dc: 1, angle: 0 }
};
const DIR_ORDER = ['up', 'right', 'down', 'left'];

const RESOURCE_COLOR = { iron: '#8a94c8', copper: '#d9873d' };
const ITEM_COLOR = {
  iron_ore: '#8a94c8', copper_ore: '#d9873d',
  iron_plate: '#c7ccef', copper_plate: '#f0b073',
  gear: '#dfe4ee', circuit: '#8be6cf'
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
const scale = canvas.width / (COLS * TILE);

function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

function makeTiles() {
  const tiles = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ resource: null, amount: 0 })));
  function patch(kind, cr, cc, radius, amount) {
    for (let r = cr - radius; r <= cr + radius; r += 1) {
      for (let c = cc - radius; c <= cc + radius; c += 1) {
        if (!inBounds(r, c)) continue;
        if (Math.hypot(r - cr, c - cc) <= radius + Math.random() * 0.6) {
          tiles[r][c] = { resource: kind, amount };
        }
      }
    }
  }
  patch('iron', 4, 5, 2, 400);
  patch('iron', 13, 20, 2, 400);
  patch('copper', 4, 20, 2, 350);
  patch('copper', 13, 5, 2, 350);
  return tiles;
}

const world = {
  tiles: makeTiles(),
  buildings: Array.from({ length: ROWS }, () => Array(COLS).fill(null))
};

const player = {
  r: 9, c: 13, dir: 'down',
  inventory: {},
  lastMove: 0, lastMine: 0
};

const state = {
  tool: 'drill',
  placeDir: 'down',
  hover: null,
  currentTick: 0,
  achieved: new Set(),
  modalTarget: null
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

function toast(message) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function building(r, c) { return inBounds(r, c) ? world.buildings[r][c] : null; }
function neighbors(r, c) { return DIR_ORDER.map(dir => ({ dir, r: r + DIRS[dir].dr, c: c + DIRS[dir].dc })); }

function placeBuilding(r, c) {
  if (!inBounds(r, c)) return;
  const dist = Math.max(Math.abs(r - player.r), Math.abs(c - player.c));
  if (dist > REACH) return toast('Troppo lontano per costruire qui.');
  const tile = world.tiles[r][c];
  const existing = world.buildings[r][c];

  if (state.tool === 'remove') {
    if (!existing) return;
    world.buildings[r][c] = null;
    return;
  }
  if (existing) return toast('C’è già qualcosa qui.');

  if (state.tool === 'drill') {
    if (!tile.resource) return toast('Il trapano va piazzato su un giacimento.');
    world.buildings[r][c] = { type: 'drill', dir: state.placeDir, progress: 0, buffer: {} };
    markAchieved('drill');
  } else if (state.tool === 'belt') {
    world.buildings[r][c] = { type: 'belt', dir: state.placeDir, item: null };
    markAchieved('belt');
  } else if (state.tool === 'assembler') {
    world.buildings[r][c] = { type: 'assembler', recipe: null, input: {}, output: {}, progress: 0 };
    markAchieved('assembler');
  } else if (state.tool === 'chest') {
    world.buildings[r][c] = { type: 'chest', storage: {} };
    markAchieved('chest');
  }
}

function markAchieved(id) { state.achieved.add(id); }

function tileFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width) / scale;
  const y = (event.clientY - rect.top) * (canvas.height / rect.height) / scale;
  return { r: Math.floor(y / TILE), c: Math.floor(x / TILE) };
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

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.hotbar-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
}
document.querySelectorAll('.hotbar-btn').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

const keys = new Set();
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  keys.add(key);
  if (key === 'r') rotatePlacement();
  if (key === 'e') interact();
  if (['1', '2', '3', '4', '5'].includes(key)) {
    const map = { 1: 'drill', 2: 'belt', 3: 'assembler', 4: 'chest', 5: 'remove' };
    setTool(map[key]);
  }
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));

function rotatePlacement() {
  const idx = DIR_ORDER.indexOf(state.placeDir);
  state.placeDir = DIR_ORDER[(idx + 1) % DIR_ORDER.length];
}

function tryMove(now) {
  if (now - player.lastMove < MOVE_COOLDOWN) return;
  let dir = null;
  if (keys.has('w') || keys.has('arrowup')) dir = 'up';
  else if (keys.has('s') || keys.has('arrowdown')) dir = 'down';
  else if (keys.has('a') || keys.has('arrowleft')) dir = 'left';
  else if (keys.has('d') || keys.has('arrowright')) dir = 'right';
  if (!dir) return;
  player.dir = dir;
  const nr = player.r + DIRS[dir].dr;
  const nc = player.c + DIRS[dir].dc;
  if (inBounds(nr, nc)) { player.r = nr; player.c = nc; }
  player.lastMove = now;
}

function facingTile() {
  const d = DIRS[player.dir];
  return { r: player.r + d.dr, c: player.c + d.dc };
}

function interact() {
  const now = performance.now();
  const { r, c } = facingTile();
  if (!inBounds(r, c)) return;
  const target = world.buildings[r][c];
  if (target && target.type === 'chest') {
    const kinds = Object.keys(target.storage);
    if (!kinds.length) return toast('La cassa è vuota.');
    kinds.forEach(kind => { addItem(player.inventory, kind, target.storage[kind]); target.storage[kind] = 0; });
    renderInventory();
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
    renderInventory();
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

function renderInventory() {
  const list = $('#inventory');
  const entries = Object.entries(player.inventory).filter(([, qty]) => qty > 0);
  list.innerHTML = entries.length
    ? entries.map(([kind, qty]) => `<li>${ITEM_LABEL[kind] || kind}<b>${qty}</b></li>`).join('')
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
      renderInventory(); renderHandCraft();
    });
    host.appendChild(btn);
  });
}

const OBJECTIVES = [
  { id: 'mine5', text: 'Estrai a mano almeno 5 minerale di ferro' },
  { id: 'drill', text: 'Piazza un Trapano Minerario su un giacimento' },
  { id: 'belt', text: 'Piazza un Nastro trasportatore' },
  { id: 'assembler', text: 'Piazza un Assemblatore e imposta una ricetta' },
  { id: 'chest', text: 'Piazza una Cassa per raccogliere l’output' },
  { id: 'gear', text: 'Produci un Ingranaggio' }
];

function renderObjectives() {
  const list = $('#objectives');
  list.innerHTML = OBJECTIVES.map(objective => {
    const done = state.achieved.has(objective.id);
    return `<li class="${done ? 'done' : ''}"><span>${done ? '✓' : '○'}</span>${objective.text}</li>`;
  }).join('');
}

function pushToNeighbor(r, c, kind, options = {}) {
  const { preferredDir } = options;
  const candidates = preferredDir ? [{ dir: preferredDir, r: r + DIRS[preferredDir].dr, c: c + DIRS[preferredDir].dc }] : neighbors(r, c);
  for (const spot of candidates) {
    if (!inBounds(spot.r, spot.c)) continue;
    const target = world.buildings[spot.r][spot.c];
    if (target && target.type === 'belt' && !target.item) {
      target.item = { kind, movedTick: state.currentTick };
      return true;
    }
    if (target && target.type === 'chest') {
      addItem(target.storage, kind, 1);
      return true;
    }
  }
  return false;
}

function pullFromNeighbors(r, c, accept) {
  for (const spot of neighbors(r, c)) {
    if (!inBounds(spot.r, spot.c)) continue;
    const source = world.buildings[spot.r][spot.c];
    if (source && source.type === 'belt' && source.item && accept(source.item.kind)) {
      const kind = source.item.kind;
      source.item = null;
      return kind;
    }
  }
  return null;
}

function tick() {
  state.currentTick += 1;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'belt' || !b.item || b.item.movedTick === state.currentTick) continue;
      const d = DIRS[b.dir];
      const nr = r + d.dr, nc = c + d.dc;
      if (!inBounds(nr, nc)) continue;
      const target = world.buildings[nr][nc];
      if (target && target.type === 'belt' && !target.item) {
        target.item = b.item; target.item.movedTick = state.currentTick;
        b.item = null;
      }
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'drill') continue;
      const tile = world.tiles[r][c];
      if (!tile.resource || tile.amount <= 0) continue;
      b.progress += 1;
      if (b.progress >= DRILL_TICKS) {
        b.progress = 0;
        const kind = `${tile.resource}_ore`;
        if (pushToNeighbor(r, c, kind, { preferredDir: b.dir })) {
          tile.amount -= 1;
          if (tile.amount <= 0) tile.resource = null;
        }
      }
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'assembler' || !b.recipe) continue;
      const recipe = RECIPES[b.recipe];
      Object.keys(recipe.input).forEach(kind => {
        if ((b.input[kind] || 0) >= recipe.input[kind] * 3) return;
        const pulled = pullFromNeighbors(r, c, k => k === kind);
        if (pulled) addItem(b.input, pulled, 1);
      });
      if (b.progress === 0 && !hasAll(b.input, recipe.input)) continue;
      if (b.progress === 0) takeAll(b.input, recipe.input);
      b.progress += 1;
      if (b.progress >= recipe.ticks) {
        b.progress = 0;
        Object.entries(recipe.output).forEach(([kind, qty]) => addItem(b.output, kind, qty));
      }
      Object.keys(b.output).forEach(kind => {
        if (b.output[kind] > 0 && pushToNeighbor(r, c, kind)) b.output[kind] -= 1;
      });
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b || b.type !== 'chest') continue;
      const pulled = pullFromNeighbors(r, c, () => true);
      if (pulled) addItem(b.storage, pulled, 1);
    }
  }

  renderObjectives();
  renderHandCraft();
}

function drawTile(r, c, color) {
  ctx.fillStyle = color;
  ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
}

function draw() {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, canvas.width / scale, canvas.height / scale);

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const tile = world.tiles[r][c];
      drawTile(r, c, tile.resource ? shade(RESOURCE_COLOR[tile.resource], tile.amount) : '#141c2c');
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
    }
  }

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const b = world.buildings[r][c];
      if (!b) continue;
      drawBuilding(r, c, b);
    }
  }

  if (state.hover) {
    const { r, c } = state.hover;
    if (inBounds(r, c)) {
      const dist = Math.max(Math.abs(r - player.r), Math.abs(c - player.c));
      ctx.strokeStyle = dist <= REACH ? 'rgba(139,124,246,.85)' : 'rgba(255,93,115,.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c * TILE + 1, r * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  const px = player.c * TILE + TILE / 2;
  const py = player.r * TILE + TILE / 2;
  ctx.fillStyle = '#ffdb7a';
  ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#151d2d'; ctx.lineWidth = 2; ctx.stroke();
  const a = DIRS[player.dir].angle;
  ctx.beginPath();
  ctx.moveTo(px + Math.cos(a) * 13, py + Math.sin(a) * 13);
  ctx.lineTo(px + Math.cos(a + 2.4) * 6, py + Math.sin(a + 2.4) * 6);
  ctx.lineTo(px + Math.cos(a - 2.4) * 6, py + Math.sin(a - 2.4) * 6);
  ctx.closePath(); ctx.fillStyle = '#ff5d73'; ctx.fill();

  ctx.restore();
}

function shade(hex, amount) {
  const alpha = Math.max(.35, Math.min(1, amount / 400));
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha * 0.55})`;
}

function drawBuilding(r, c, b) {
  const x = c * TILE, y = r * TILE;
  if (b.type === 'belt') {
    ctx.fillStyle = 'rgba(139,124,246,.16)';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    const a = DIRS[b.dir].angle;
    const cx = x + TILE / 2, cy = y + TILE / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (b.item) { ctx.fillStyle = ITEM_COLOR[b.item.kind] || '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill(); }
    return;
  }
  if (b.type === 'drill') {
    ctx.fillStyle = '#3b4256';
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = '#ffb35c';
    ctx.fillRect(x + 3, y + TILE - 8, (TILE - 6) * (b.progress / DRILL_TICKS), 5);
    ctx.fillStyle = '#dfe4ee'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⛏', x + TILE / 2, y + TILE / 2 + 5);
    return;
  }
  if (b.type === 'assembler') {
    ctx.fillStyle = b.recipe ? 'rgba(139,124,246,.35)' : 'rgba(255,255,255,.08)';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = 'rgba(139,124,246,.6)'; ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#dfe4ee'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⚙', x + TILE / 2, y + TILE / 2 + 5);
    if (b.recipe) {
      const recipe = RECIPES[b.recipe];
      ctx.fillStyle = '#55d6be';
      ctx.fillRect(x + 3, y + TILE - 7, (TILE - 6) * (b.progress / recipe.ticks), 4);
    }
    return;
  }
  if (b.type === 'chest') {
    ctx.fillStyle = '#5c4326';
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = '#dfe4ee'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('▤', x + TILE / 2, y + TILE / 2 + 5);
    const total = Object.values(b.storage).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      ctx.fillStyle = '#ffdb7a'; ctx.font = '9px sans-serif';
      ctx.fillText(String(total), x + TILE / 2, y + TILE - 4);
    }
  }
}

let lastTickAt = 0;
function loop(timestamp) {
  tryMove(timestamp);
  if (timestamp - lastTickAt >= TICK_MS) { lastTickAt = timestamp; tick(); }
  draw();
  requestAnimationFrame(loop);
}

renderInventory();
renderHandCraft();
renderObjectives();
requestAnimationFrame(loop);
