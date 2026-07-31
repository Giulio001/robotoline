'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'terranovaland.json');
const WORLD_LIMIT = 48;
const MAX_CHAT_LENGTH = 180;
const PLAYER_SPEED_LIMIT = 25;
const BLOCK_TYPES = new Set(['grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'planks', 'brick', 'obsidian', 'crystal', 'coal', 'iron', 'gold', 'snow', 'torch']);

const RECIPES = {
  planks: { label: 'Assi di quercia', cost: { wood: 1 }, gives: { planks: 4 } },
  woodPickaxe: { label: 'Piccone di legno', cost: { planks: 5 }, gives: { woodPickaxe: 1 } },
  stonePickaxe: { label: 'Piccone di pietra', cost: { planks: 3, stone: 5 }, gives: { stonePickaxe: 1 } },
  stoneSword: { label: 'Spada di pietra', cost: { planks: 2, stone: 4 }, gives: { stoneSword: 1 } },
  ironPickaxe: { label: 'Piccone di ferro', cost: { planks: 3, iron: 5 }, gives: { ironPickaxe: 1 } },
  crystalSword: { label: 'Spada di cristallo', cost: { planks: 2, crystal: 6, gold: 2 }, gives: { crystalSword: 1 } },
  brick: { label: 'Mattoni', cost: { stone: 2, coal: 1 }, gives: { brick: 3 } },
  torch: { label: 'Torcia', cost: { wood: 1, coal: 1 }, gives: { torch: 4 } }
};

const SHOP = {
  bread: { label: 'Pane del viandante', price: 12, gives: { bread: 1 } },
  woodPickaxe: { label: 'Piccone di legno', price: 35, gives: { woodPickaxe: 1 } },
  ironPickaxe: { label: 'Piccone di ferro', price: 180, gives: { ironPickaxe: 1 } },
  crystalSword: { label: 'Spada di cristallo', price: 420, gives: { crystalSword: 1 } },
  dragonTreat: { label: 'Dono per draghi', price: 250, gives: { dragonTreat: 1 } }
};

const QUESTS = [
  { id: 'first_hunt', title: 'Difendi Terranovaland', description: 'Sconfiggi 5 creature ostili', type: 'kills', goal: 5, reward: 90 },
  { id: 'deep_miner', title: 'Il richiamo della miniera', description: 'Scava 24 blocchi', type: 'mined', goal: 24, reward: 70 },
  { id: 'artisan', title: 'Mani sapienti', description: 'Crea 4 oggetti', type: 'crafted', goal: 4, reward: 80 }
];

function fract(value) {
  return value - Math.floor(value);
}

function terrainHeight(x, z) {
  const broad = Math.sin(x * 0.13) * 2.1 + Math.cos(z * 0.11) * 1.8;
  const detail = (fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) - 0.5) * 1.6;
  const spawnPlateau = Math.max(0, 1 - Math.hypot(x, z) / 8);
  return Math.max(3, Math.min(15, Math.floor(7 + broad + detail + spawnPlateau * 2)));
}

const SPAWN = Object.freeze({ x: 0, y: terrainHeight(0, 0) + 2.2, z: 0 });

function defaultState() {
  return { version: 1, worldSeed: 'TERRANOVA-3107', blocks: {}, profiles: {}, clans: {}, worldDay: 0.28 };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    return { ...defaultState(), ...parsed, blocks: parsed.blocks || {}, profiles: parsed.profiles || {}, clans: parsed.clans || {} };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Salvataggio non leggibile, avvio un mondo nuovo:', error.message);
    return defaultState();
  }
}

let state = loadState();
let saveTimer = null;

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const temporary = `${SAVE_FILE}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state));
      fs.renameSync(temporary, SAVE_FILE);
    } catch (error) {
      console.error('Errore salvataggio:', error);
    }
  }, 350);
}

function cleanText(value, max = MAX_CHAT_LENGTH) {
  return String(value || '').replace(/[<>\u0000-\u001F]/g, '').trim().slice(0, max);
}

function profileKey(name) {
  return name.toLocaleLowerCase('it-IT');
}

function freshProfile(name) {
  return {
    name,
    coins: 35,
    health: 100,
    inventory: { grass: 12, dirt: 8, wood: 6, stone: 3, bread: 2 },
    stats: { kills: 0, mined: 0, crafted: 0, deaths: 0 },
    claimedQuests: [],
    clan: null,
    lastSeen: Date.now()
  };
}

function publicProfile(profile) {
  return {
    name: profile.name,
    coins: profile.coins,
    health: profile.health,
    inventory: profile.inventory,
    stats: profile.stats,
    claimedQuests: profile.claimedQuests,
    clan: profile.clan
  };
}

function hasItems(profile, cost) {
  return Object.entries(cost).every(([item, amount]) => (profile.inventory[item] || 0) >= amount);
}

function addItems(profile, items) {
  for (const [item, amount] of Object.entries(items)) profile.inventory[item] = (profile.inventory[item] || 0) + amount;
}

function removeItems(profile, items) {
  for (const [item, amount] of Object.entries(items)) {
    profile.inventory[item] = Math.max(0, (profile.inventory[item] || 0) - amount);
    if (!profile.inventory[item]) delete profile.inventory[item];
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

const players = new Map();
const monsters = new Map();
const dragons = new Map();

const MONSTER_KINDS = {
  slime: { hp: 30, damage: 7, speed: 1.15, coins: [4, 10], drop: 'coal' },
  boar: { hp: 48, damage: 10, speed: 1.8, coins: [7, 14], drop: 'iron' },
  golem: { hp: 85, damage: 16, speed: 0.72, coins: [14, 25], drop: 'gold' },
  wraith: { hp: 58, damage: 13, speed: 1.35, coins: [11, 20], drop: 'crystal' }
};

function randomWorldPosition(minDistance = 10) {
  let x;
  let z;
  do {
    x = Math.floor((Math.random() - 0.5) * (WORLD_LIMIT * 1.7));
    z = Math.floor((Math.random() - 0.5) * (WORLD_LIMIT * 1.7));
  } while (Math.hypot(x, z) < minDistance);
  return { x, y: terrainHeight(x, z) + 1.1, z };
}

function spawnMonster(kind) {
  const stats = MONSTER_KINDS[kind];
  const position = randomWorldPosition(9);
  const monster = { id: randomId('mob'), kind, ...position, hp: stats.hp, maxHp: stats.hp, yaw: Math.random() * Math.PI * 2, target: null, lastAttack: 0 };
  monsters.set(monster.id, monster);
  return monster;
}

function ensurePopulation() {
  const kinds = Object.keys(MONSTER_KINDS);
  while (monsters.size < 20) spawnMonster(kinds[Math.floor(Math.random() * kinds.length)]);
  if (!dragons.size) {
    const dragonPositions = [{ x: 13, z: -15 }, { x: -22, z: 18 }];
    dragonPositions.forEach((position, index) => dragons.set(`dragon_${index + 1}`, {
      id: `dragon_${index + 1}`,
      name: index ? 'Nembofiamma' : 'Auralis',
      x: position.x,
      y: terrainHeight(position.x, position.z) + 1.8,
      z: position.z,
      yaw: index * Math.PI,
      rider: null
    }));
  }
}

ensurePopulation();

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), { maxAge: '30d' }));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm', 'controls'), { maxAge: '30d' }));
app.get('/health', (_req, res) => res.json({ ok: true, players: players.size, uptime: Math.round(process.uptime()) }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'], maxHttpBufferSize: 100_000 });

function serializePlayers() {
  return [...players.values()].map(({ socketId, ...player }) => player);
}

function serializeClans() {
  return Object.values(state.clans).map(clan => ({ name: clan.name, leader: clan.leader, members: clan.members, treasury: clan.treasury || 0 }));
}

function sendProfile(socket, profile, message) {
  socket.emit('profile', { ...publicProfile(profile), quests: QUESTS, message });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function validCoordinate(value) {
  return Number.isInteger(value) && value >= -WORLD_LIMIT && value <= WORLD_LIMIT;
}

function completeQuests(socket, profile) {
  for (const quest of QUESTS) {
    if (!profile.claimedQuests.includes(quest.id) && (profile.stats[quest.type] || 0) >= quest.goal) {
      profile.claimedQuests.push(quest.id);
      profile.coins += quest.reward;
      socket.emit('toast', { type: 'quest', text: `Missione completata: ${quest.title} · +${quest.reward} monete` });
    }
  }
}

io.on('connection', socket => {
  let key = null;

  socket.on('login', raw => {
    if (key) return;
    const name = cleanText(raw?.name, 18).replace(/\s+/g, ' ');
    if (name.length < 2) return socket.emit('loginError', 'Inserisci un nome di almeno 2 caratteri.');
    key = profileKey(name);
    if ([...players.values()].some(player => profileKey(player.name) === key)) {
      key = null;
      return socket.emit('loginError', 'Questo nome è già in partita. Scegline un altro.');
    }

    const profile = state.profiles[key] || freshProfile(name);
    profile.name = name;
    profile.health = Math.max(1, profile.health || 100);
    profile.lastSeen = Date.now();
    state.profiles[key] = profile;
    const player = { id: socket.id, socketId: socket.id, name, x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, yaw: 0, pitch: 0, health: profile.health, clan: profile.clan, mountedDragon: null, lastMoveAt: Date.now(), lastAttackAt: 0 };
    players.set(socket.id, player);

    socket.emit('welcome', {
      self: player,
      spawn: SPAWN,
      worldSeed: state.worldSeed,
      worldDay: state.worldDay,
      blocks: state.blocks,
      players: serializePlayers(),
      monsters: [...monsters.values()],
      dragons: [...dragons.values()],
      clans: serializeClans(),
      profile: { ...publicProfile(profile), quests: QUESTS },
      recipes: RECIPES,
      shop: SHOP
    });
    socket.broadcast.emit('playerJoined', player);
    io.emit('systemMessage', `${name} è entrato a Terranovaland`);
    persistSoon();
  });

  socket.on('move', data => {
    const player = players.get(socket.id);
    if (!player || !data) return;
    const now = Date.now();
    const elapsed = Math.max(0.05, (now - player.lastMoveAt) / 1000);
    const next = { x: Number(data.x), y: Number(data.y), z: Number(data.z) };
    if (!Object.values(next).every(Number.isFinite)) return;
    if (Math.abs(next.x) > WORLD_LIMIT + 10 || Math.abs(next.z) > WORLD_LIMIT + 10 || next.y < -5 || next.y > 80) return;
    const maxTravel = player.mountedDragon ? 38 * elapsed + 2 : PLAYER_SPEED_LIMIT * elapsed + 1.2;
    if (distance(player, next) > maxTravel) return;
    Object.assign(player, next, { yaw: Number(data.yaw) || 0, pitch: Number(data.pitch) || 0, lastMoveAt: now });
    if (player.mountedDragon) {
      const dragon = dragons.get(player.mountedDragon);
      if (dragon) Object.assign(dragon, next, { y: next.y - 1.1, yaw: player.yaw });
    }
    socket.broadcast.volatile.emit('playerMoved', { id: player.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, mountedDragon: player.mountedDragon });
  });

  socket.on('mine', data => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const block = cleanText(data?.block, 16);
    const position = { x: Number(data?.x), y: Number(data?.y), z: Number(data?.z) };
    if (!player || !profile || !BLOCK_TYPES.has(block) || !validCoordinate(position.x) || !validCoordinate(position.z) || !Number.isInteger(position.y) || position.y < 0 || position.y > 24) return;
    if (distance(player, position) > 7 || position.y === 0) return;
    if (['stone', 'coal', 'iron', 'gold', 'crystal', 'obsidian'].includes(block)) {
      const tools = ['woodPickaxe', 'stonePickaxe', 'ironPickaxe'];
      if (!tools.some(tool => profile.inventory[tool])) return socket.emit('toast', { type: 'danger', text: 'Ti serve un piccone per scavare questo materiale.' });
    }
    const blockKey = `${position.x},${position.y},${position.z}`;
    if (state.blocks[blockKey] === 0) return;
    state.blocks[blockKey] = 0;
    addItems(profile, { [block]: 1 });
    profile.stats.mined += 1;
    completeQuests(socket, profile);
    io.emit('blockChanged', { ...position, type: 0, by: player.name });
    sendProfile(socket, profile);
    persistSoon();
  });

  socket.on('place', data => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const type = cleanText(data?.type, 16);
    const position = { x: Number(data?.x), y: Number(data?.y), z: Number(data?.z) };
    if (!player || !profile || !BLOCK_TYPES.has(type) || !(profile.inventory[type] > 0)) return;
    if (!validCoordinate(position.x) || !validCoordinate(position.z) || !Number.isInteger(position.y) || position.y < 1 || position.y > 24 || distance(player, position) > 7) return;
    if (Math.hypot(position.x - SPAWN.x, position.z - SPAWN.z) < 3.5) return socket.emit('toast', { type: 'danger', text: 'La piazza dello spawn è protetta.' });
    const blockKey = `${position.x},${position.y},${position.z}`;
    state.blocks[blockKey] = type;
    removeItems(profile, { [type]: 1 });
    io.emit('blockChanged', { ...position, type, by: player.name });
    sendProfile(socket, profile);
    persistSoon();
  });

  socket.on('attack', data => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const monster = monsters.get(String(data?.id));
    const now = Date.now();
    if (!player || !profile || !monster || now - player.lastAttackAt < 360 || distance(player, monster) > 5.2) return;
    player.lastAttackAt = now;
    const held = cleanText(data?.held, 20);
    let damage = 8;
    if (held === 'stoneSword' && profile.inventory.stoneSword) damage = 18;
    if (held === 'crystalSword' && profile.inventory.crystalSword) damage = 34;
    monster.hp -= damage;
    monster.target = player.id;
    io.emit('monsterHit', { id: monster.id, hp: monster.hp, damage, by: player.name });
    if (monster.hp <= 0) {
      const stats = MONSTER_KINDS[monster.kind];
      const earned = Math.floor(stats.coins[0] + Math.random() * (stats.coins[1] - stats.coins[0] + 1));
      profile.coins += earned;
      profile.stats.kills += 1;
      if (Math.random() < 0.7) addItems(profile, { [stats.drop]: 1 });
      monsters.delete(monster.id);
      io.emit('monsterDefeated', { id: monster.id, by: player.name, coins: earned });
      socket.emit('toast', { type: 'coin', text: `Creatura sconfitta · +${earned} monete` });
      completeQuests(socket, profile);
      setTimeout(() => { const next = spawnMonster(monster.kind); io.emit('monsterSpawned', next); }, 5000);
      sendProfile(socket, profile);
      persistSoon();
    }
  });

  socket.on('craft', recipeId => {
    const profile = key && state.profiles[key];
    const recipe = RECIPES[String(recipeId)];
    if (!profile || !recipe) return;
    if (!hasItems(profile, recipe.cost)) return socket.emit('toast', { type: 'danger', text: 'Non hai ancora i materiali necessari.' });
    removeItems(profile, recipe.cost);
    addItems(profile, recipe.gives);
    profile.stats.crafted += 1;
    completeQuests(socket, profile);
    sendProfile(socket, profile, `${recipe.label} creato`);
    persistSoon();
  });

  socket.on('buy', productId => {
    const profile = key && state.profiles[key];
    const product = SHOP[String(productId)];
    if (!profile || !product) return;
    if (profile.coins < product.price) return socket.emit('toast', { type: 'danger', text: 'Non hai abbastanza monete.' });
    profile.coins -= product.price;
    addItems(profile, product.gives);
    sendProfile(socket, profile, `${product.label} acquistato`);
    persistSoon();
  });

  socket.on('consume', item => {
    const profile = key && state.profiles[key];
    const player = players.get(socket.id);
    if (!profile || !player || item !== 'bread' || !(profile.inventory.bread > 0) || profile.health >= 100) return;
    removeItems(profile, { bread: 1 });
    profile.health = Math.min(100, profile.health + 28);
    player.health = profile.health;
    sendProfile(socket, profile, 'Energia recuperata');
    socket.emit('health', profile.health);
    persistSoon();
  });

  socket.on('mountDragon', dragonId => {
    const profile = key && state.profiles[key];
    const player = players.get(socket.id);
    const dragon = dragons.get(String(dragonId));
    if (!profile || !player || !dragon) return;
    if (player.mountedDragon) {
      const current = dragons.get(player.mountedDragon);
      if (current) current.rider = null;
      player.mountedDragon = null;
      socket.emit('dragonMounted', { id: null });
      io.emit('dragons', [...dragons.values()]);
      return;
    }
    if (dragon.rider || distance(player, dragon) > 5) return;
    if (!(profile.inventory.dragonTreat > 0)) return socket.emit('toast', { type: 'danger', text: 'Un drago si fida solo di chi gli offre un Dono per draghi.' });
    removeItems(profile, { dragonTreat: 1 });
    dragon.rider = player.id;
    player.mountedDragon = dragon.id;
    socket.emit('dragonMounted', { id: dragon.id, name: dragon.name });
    sendProfile(socket, profile);
    io.emit('dragons', [...dragons.values()]);
    persistSoon();
  });

  socket.on('clanAction', data => {
    const profile = key && state.profiles[key];
    const player = players.get(socket.id);
    if (!profile || !player) return;
    const action = String(data?.action || '');
    const requestedName = cleanText(data?.name, 20).replace(/\s+/g, ' ');
    if (action === 'create') {
      if (profile.clan) return socket.emit('toast', { type: 'danger', text: 'Lascia il clan attuale prima di crearne uno.' });
      if (requestedName.length < 3) return socket.emit('toast', { type: 'danger', text: 'Il nome del clan deve avere almeno 3 caratteri.' });
      const clanKey = profileKey(requestedName);
      if (state.clans[clanKey]) return socket.emit('toast', { type: 'danger', text: 'Esiste già un clan con questo nome.' });
      state.clans[clanKey] = { name: requestedName, leader: profile.name, members: [profile.name], treasury: 0 };
      profile.clan = requestedName;
    } else if (action === 'join') {
      if (profile.clan) return;
      const clan = state.clans[profileKey(requestedName)];
      if (!clan || clan.members.length >= 12) return socket.emit('toast', { type: 'danger', text: 'Clan non disponibile o al completo.' });
      clan.members.push(profile.name);
      profile.clan = clan.name;
    } else if (action === 'leave' && profile.clan) {
      const clanKey = profileKey(profile.clan);
      const clan = state.clans[clanKey];
      if (clan) {
        clan.members = clan.members.filter(member => profileKey(member) !== key);
        if (!clan.members.length) delete state.clans[clanKey];
        else if (profileKey(clan.leader) === key) clan.leader = clan.members[0];
      }
      profile.clan = null;
    }
    player.clan = profile.clan;
    sendProfile(socket, profile);
    io.emit('clans', serializeClans());
    io.emit('playerClan', { id: player.id, clan: player.clan });
    persistSoon();
  });

  socket.on('chat', raw => {
    const player = players.get(socket.id);
    const text = cleanText(raw);
    if (!player || !text) return;
    io.emit('chat', { name: player.name, clan: player.clan, text, at: Date.now() });
  });

  socket.on('respawn', () => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    if (!player || !profile || profile.health > 0) return;
    Object.assign(player, SPAWN, { health: 100, mountedDragon: null });
    profile.health = 100;
    socket.emit('respawned', { ...SPAWN, health: 100 });
    sendProfile(socket, profile);
    persistSoon();
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (!player) return;
    if (player.mountedDragon) {
      const dragon = dragons.get(player.mountedDragon);
      if (dragon) dragon.rider = null;
    }
    const profile = key && state.profiles[key];
    if (profile) {
      profile.health = Math.max(1, player.health);
      profile.lastSeen = Date.now();
    }
    players.delete(socket.id);
    socket.broadcast.emit('playerLeft', socket.id);
    io.emit('systemMessage', `${player.name} ha lasciato Terranovaland`);
    persistSoon();
  });
});

let previousTick = Date.now();
function updateWorld() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - previousTick) / 1000);
  previousTick = now;
  state.worldDay = (state.worldDay + dt / 720) % 1;

  for (const monster of monsters.values()) {
    let closest = null;
    let closestDistance = 16;
    for (const player of players.values()) {
      const currentDistance = Math.hypot(player.x - monster.x, player.z - monster.z);
      if (currentDistance < closestDistance && player.health > 0 && !player.mountedDragon) {
        closest = player;
        closestDistance = currentDistance;
      }
    }
    const stats = MONSTER_KINDS[monster.kind];
    if (closest) {
      const angle = Math.atan2(closest.x - monster.x, closest.z - monster.z);
      monster.yaw = angle;
      if (closestDistance > 1.45) {
        monster.x += Math.sin(angle) * stats.speed * dt;
        monster.z += Math.cos(angle) * stats.speed * dt;
        monster.y = terrainHeight(Math.round(monster.x), Math.round(monster.z)) + 1.1;
      } else if (now - monster.lastAttack > 1100) {
        monster.lastAttack = now;
        closest.health = Math.max(0, closest.health - stats.damage);
        const profile = state.profiles[profileKey(closest.name)];
        if (profile) profile.health = closest.health;
        io.to(closest.socketId).emit('health', closest.health);
        io.to(closest.socketId).emit('playerDamaged', { amount: stats.damage, source: monster.kind });
        if (closest.health === 0 && profile) {
          profile.stats.deaths += 1;
          io.to(closest.socketId).emit('playerDied');
          persistSoon();
        }
      }
    } else {
      monster.yaw += (Math.random() - 0.5) * dt;
      monster.x += Math.sin(monster.yaw) * stats.speed * 0.18 * dt;
      monster.z += Math.cos(monster.yaw) * stats.speed * 0.18 * dt;
    }
  }
  if (players.size) io.volatile.emit('worldTick', { day: state.worldDay, monsters: [...monsters.values()], dragons: [...dragons.values()] });
}

if (require.main === module) {
  setInterval(updateWorld, 100);
  setInterval(persistSoon, 30_000);
  server.listen(PORT, HOST, () => {
    console.log(`Terranovaland è online su http://${HOST}:${PORT}`);
  });
}

function shutdown() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(state));
  } catch (error) {
    console.error(error);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { server, terrainHeight, SPAWN, RECIPES, SHOP };
