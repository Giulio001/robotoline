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
const WORLD_LIMIT = 8192;
const MAX_CHAT_LENGTH = 180;
const PLAYER_SPEED_LIMIT = 25;
const BLOCK_TYPES = new Set(['grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'planks', 'brick', 'obsidian', 'crystal', 'coal', 'iron', 'gold', 'snow', 'torch', 'redstone', 'redstoneWire', 'lever', 'lamp', 'piston']);
const CIRCUIT_TYPES = new Set(['redstoneWire', 'lever', 'lamp', 'piston']);

const RECIPES = {
  planks: { label: 'Assi di quercia', cost: { wood: 1 }, gives: { planks: 4 } },
  woodPickaxe: { label: 'Piccone di legno', cost: { planks: 5 }, gives: { woodPickaxe: 1 } },
  stonePickaxe: { label: 'Piccone di pietra', cost: { planks: 3, stone: 5 }, gives: { stonePickaxe: 1 } },
  stoneSword: { label: 'Spada di pietra', cost: { planks: 2, stone: 4 }, gives: { stoneSword: 1 } },
  ironPickaxe: { label: 'Piccone di ferro', cost: { planks: 3, iron: 5 }, gives: { ironPickaxe: 1 } },
  crystalSword: { label: 'Spada di cristallo', cost: { planks: 2, crystal: 6, gold: 2 }, gives: { crystalSword: 1 } },
  brick: { label: 'Mattoni', cost: { stone: 2, coal: 1 }, gives: { brick: 3 } },
  torch: { label: 'Torcia', cost: { wood: 1, coal: 1 }, gives: { torch: 4 } },
  redstoneWire: { label: 'Circuito di pietrarossa', cost: { redstone: 1 }, gives: { redstoneWire: 4 } },
  lever: { label: 'Leva', cost: { stone: 1, wood: 1 }, gives: { lever: 1 } },
  lamp: { label: 'Lampada alimentata', cost: { redstone: 3, crystal: 1 }, gives: { lamp: 1 } },
  piston: { label: 'Pistone', cost: { planks: 3, stone: 4, iron: 1, redstone: 1 }, gives: { piston: 1 } },
  ironHelmet: { label: 'Elmo di ferro', cost: { iron: 5 }, gives: { ironHelmet: 1 } },
  ironChestplate: { label: 'Corazza di ferro', cost: { iron: 8 }, gives: { ironChestplate: 1 } },
  ironBoots: { label: 'Stivali di ferro', cost: { iron: 4 }, gives: { ironBoots: 1 } },
  healingPotion: { label: 'Pozione curativa', cost: { crystal: 1, bread: 1 }, gives: { healingPotion: 2 } }
};

const SHOP = {
  bread: { label: 'Pane del viandante', price: 12, gives: { bread: 1 } },
  woodPickaxe: { label: 'Piccone di legno', price: 35, gives: { woodPickaxe: 1 } },
  ironPickaxe: { label: 'Piccone di ferro', price: 180, gives: { ironPickaxe: 1 } },
  crystalSword: { label: 'Spada di cristallo', price: 420, gives: { crystalSword: 1 } },
  dragonTreat: { label: 'Dono per draghi', price: 250, gives: { dragonTreat: 1 } },
  healingPotion: { label: 'Pozione curativa', price: 45, gives: { healingPotion: 1 } },
  ironHelmet: { label: 'Elmo di ferro', price: 130, gives: { ironHelmet: 1 } }
};

const QUESTS = [
  { id:'wood_call',title:'Il richiamo del bosco',description:'Taglia 4 blocchi di legno',event:'mine',target:'wood',goal:4,reward:{coins:20,xp:25,items:{planks:4}} },
  { id:'true_pickaxe',title:'Un vero piccone',description:'Crea un piccone di pietra',event:'craft',target:'stonePickaxe',goal:1,reward:{coins:30,xp:35,items:{bread:2}} },
  { id:'stone_sweat',title:'Pietra e sudore',description:'Estrai 12 blocchi di pietra',event:'mine',target:'stone',goal:12,reward:{coins:35,xp:45,items:{coal:2}} },
  { id:'light_darkness',title:'Luce nell’oscurità',description:'Crea delle torce',event:'craft',target:'torch',goal:1,reward:{coins:40,xp:50,items:{iron:2}} },
  { id:'lost_cartographer',title:'Il cartografo scomparso',description:'Raggiungi il Castello delle Vele',event:'visit',target:'castle',goal:1,marker:{x:24,z:24,label:'Castello delle Vele'},reward:{coins:60,xp:75,items:{mapFragment:1}} },
  { id:'ancient_crystal',title:'Il cristallo antico',description:'Estrai un cristallo dalle profondità',event:'mine',target:'crystal',goal:1,reward:{coins:70,xp:90,items:{redstone:4}} },
  { id:'signal_fire',title:'Accendi il segnale',description:'Attiva una leva collegata a un circuito',event:'circuit',target:'lever',goal:1,reward:{coins:60,xp:85,items:{lamp:2}} },
  { id:'wild_hunt',title:'La caccia selvaggia',description:'Sconfiggi 5 creature',event:'kill',target:'any',goal:5,reward:{coins:80,xp:100,items:{healingPotion:2}} },
  { id:'stone_beast',title:'La bestia rocciosa',description:'Sconfiggi un Golem antico',event:'kill',target:'golem',goal:1,reward:{coins:100,xp:125,items:{iron:5}} },
  { id:'companions',title:'Una compagnia fidata',description:'Crea o raggiungi un clan',event:'clan',target:'any',goal:1,reward:{coins:80,xp:110,items:{gold:2}} },
  { id:'outpost',title:'L’avamposto',description:'Posiziona 12 blocchi per costruire una base',event:'place',target:'any',goal:12,reward:{coins:90,xp:140,items:{brick:20}} },
  { id:'sky_pact',title:'Il patto dei cieli',description:'Conquista la fiducia di un drago',event:'mount',target:'dragon',goal:1,reward:{coins:120,xp:170,items:{crystal:3}} },
  { id:'buried_dungeon',title:'Il dungeon sepolto',description:'Trova l’ingresso del Dungeon d’Ossidiana',event:'visit',target:'dungeon',goal:1,marker:{x:-24,z:-24,label:'Dungeon d’Ossidiana'},reward:{coins:140,xp:200,items:{healingPotion:3}} },
  { id:'ancient_guardian',title:'Il Guardiano Antico',description:'Sconfiggi il guardiano del dungeon',event:'kill',target:'ancientGuardian',goal:1,marker:{x:-24,z:-24,label:'Guardiano Antico'},reward:{coins:220,xp:300,items:{guardianBlade:1}} },
  { id:'heart_corruption',title:'Il cuore della corruzione',description:'Sconfiggi il Drago del Vuoto',event:'kill',target:'voidDragon',goal:1,marker:{x:58,z:-54,label:'Picco della Corruzione'},reward:{coins:500,xp:600,items:{crownOfTerranova:1}} }
];

function fract(value) {
  return value - Math.floor(value);
}

function terrainHeight(x, z) {
  const broad = Math.sin(x * 0.13) * 2.1 + Math.cos(z * 0.11) * 1.8;
  const detail = (fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) - 0.5) * 1.6;
  const spawnPlateau = Math.max(0, 1 - Math.hypot(x, z) / 8);
  let height = Math.max(3, Math.min(15, Math.floor(7 + broad + detail + spawnPlateau * 2)));
  const river = Math.abs(x - (16 + Math.sin(z * .12) * 5));
  const tributary = Math.abs(z - (-20 + Math.cos(x * .1) * 4));
  if (river < 2.4) height = Math.min(height, 4 + Math.floor(river * .55));
  if (tributary < 1.8 && x > 4) height = Math.min(height, 4 + Math.floor(tributary * .65));
  const lakeDistance = Math.hypot(x + 13, z - 18);
  if (lakeDistance < 6.5) height = Math.min(height, 4 + Math.floor(lakeDistance / 4));
  return height;
}

function biomeAt(x, z) {
  if (Math.hypot(x, z) < 12) return 'meadow';
  const temperature = Math.sin(x * .018) * .55 + Math.cos(z * .014) * .45;
  const moisture = Math.cos(x * .013 + z * .019) * .6 + Math.sin(z * .026) * .4;
  const volcanic = fract(Math.sin(Math.floor(x / 36) * 91.7 + Math.floor(z / 36) * 47.3) * 43758.5453);
  if (volcanic > .91 && Math.hypot(x, z) > 35) return 'volcanic';
  if (temperature < -.45) return 'frost';
  if (temperature > .48 && moisture < -.08) return 'desert';
  if (moisture > .48 && temperature > -.15) return 'swamp';
  if (moisture > .02) return 'forest';
  return 'meadow';
}

const SPAWN = Object.freeze({ x: 0, y: terrainHeight(0, 0) + 2.2, z: 0 });

const NPCS = [
  { id:'elda',name:'Elda',role:'Custode di Terranovaland',x:2,y:terrainHeight(2,0)+1.1,z:0,color:'#5fb98e' },
  { id:'borin',name:'Borin',role:'Fabbro delle Colline',x:-3,y:terrainHeight(-3,2)+1.1,z:2,color:'#c98255' },
  { id:'asha',name:'Asha',role:'Alchimista',x:4,y:terrainHeight(4,-3)+1.1,z:-3,color:'#9b78cf' },
  { id:'lyra',name:'Lyra',role:'Cartografa reale',x:22,y:terrainHeight(24,24)+1.1,z:22,color:'#d4b458' },
  { id:'kael',name:'Kael',role:'Custode dei draghi',x:11,y:terrainHeight(11,-13)+1.1,z:-13,color:'#4ca8b8' }
];

const WORLD_CHESTS = [
  { id:'castle_vault',name:'Tesoro del Castello',x:24,y:terrainHeight(24,24)+1.1,z:27,loot:{coins:90,items:{gold:3,iron:4,mapFragment:1}} },
  { id:'dungeon_heart',name:'Scrigno d’Ossidiana',x:-24,y:terrainHeight(-24,-24)-3.8,z:-24,loot:{coins:160,items:{crystal:4,redstone:8,healingPotion:2,ancientKey:1}} },
  { id:'corrupt_cache',name:'Reliquiario Corrotto',x:55,y:terrainHeight(55,-52)+1.1,z:-52,loot:{coins:220,items:{gold:6,crystal:5,dragonTreat:1}} },
  { id:'sunken_crypt_cache',name:'Tesoro della Cripta',x:72,y:terrainHeight(72,40)-3.8,z:40,loot:{coins:145,items:{crystal:3,healingPotion:2,swiftBoots:1}} },
  { id:'ember_vault_cache',name:'Forziere delle Braci',x:-72,y:terrainHeight(-72,-40)-3.8,z:-40,loot:{coins:175,items:{gold:4,redstone:6,frostHelmet:1}} },
  { id:'celestial_cache',name:'Tesoro del Bastione Celeste',x:104,y:21.1,z:72,loot:{coins:210,items:{gold:5,crystal:6,swiftBoots:1}} },
  { id:'storm_cache',name:'Tesoro delle Tempeste',x:-104,y:21.1,z:88,loot:{coins:240,items:{crystal:7,healingPotion:3,voidScale:1}} }
];

const LANDMARKS = [
  { id:'mirror_lake',name:'Lago dello Specchio',type:'lago',x:-13,z:18,radius:8,reward:{coins:18,xp:30} },
  { id:'silver_river',name:'Fiume d’Argento',type:'fiume',x:16,z:0,radius:6,reward:{coins:15,xp:25} },
  { id:'castle_sails',name:'Castello delle Vele',type:'castello',x:24,z:24,radius:10,reward:{coins:35,xp:55} },
  { id:'dragon_roost',name:'Rifugio di Auralis',type:'nido di draghi',x:13,z:-15,radius:9,reward:{coins:30,xp:45} },
  { id:'obsidian_dungeon',name:'Dungeon d’Ossidiana',type:'dungeon',x:-24,z:-24,radius:9,reward:{coins:45,xp:70} },
  { id:'frost_shrine',name:'Santuario del Gelo',type:'santuario',x:-56,z:40,radius:10,reward:{coins:40,xp:65} },
  { id:'western_ruins',name:'Rovine dei Primi',type:'rovine',x:-40,z:8,radius:10,reward:{coins:32,xp:55} },
  { id:'corruption_peak',name:'Picco della Corruzione',type:'picco',x:58,z:-54,radius:12,reward:{coins:65,xp:90} },
  { id:'sunken_crypt',name:'Cripta Sommersa',type:'dungeon',x:72,z:40,radius:10,reward:{coins:48,xp:75} },
  { id:'ember_vault',name:'Volta delle Braci',type:'dungeon',x:-72,z:-40,radius:10,reward:{coins:52,xp:80} },
  { id:'celestial_bastion',name:'Bastione Celeste',type:'dungeon sospeso',x:104,z:72,minY:18,radius:12,reward:{coins:75,xp:110} },
  { id:'storm_citadel',name:'Cittadella delle Tempeste',type:'dungeon sospeso',x:-104,z:88,minY:18,radius:12,reward:{coins:80,xp:120} }
];

const SKILLS = Object.freeze({
  miner: { name:'Minatore',max:5,description:'Più velocità e possibilità di ottenere risorse doppie.' },
  warrior: { name:'Guerriero',max:5,description:'Aumenta il danno inflitto con ogni arma.' },
  vitality: { name:'Vitalità',max:5,description:'Aumenta la vita massima di 10 per grado.' },
  explorer: { name:'Esploratore',max:5,description:'Più velocità, ricompense e fortuna nel loot.' }
});

const ITEM_RARITY = Object.freeze({ guardianCore:'epic',voidScale:'legendary',guardianBlade:'legendary',crownOfTerranova:'legendary',ancientKey:'rare',frostHelmet:'epic',swiftBoots:'rare',voidChestplate:'legendary',healingPotion:'uncommon',crystal:'rare',gold:'uncommon' });

const LOOT_TABLES = Object.freeze({
  slime: [{item:'coal',weight:48},{item:'bread',weight:24},{item:'healingPotion',weight:8},{item:'crystal',weight:3}],
  boar: [{item:'iron',weight:42},{item:'bread',weight:28,amount:2},{item:'gold',weight:8},{item:'swiftBoots',weight:1}],
  golem: [{item:'iron',weight:35,amount:2},{item:'gold',weight:24},{item:'redstone',weight:18,amount:2},{item:'frostHelmet',weight:2}],
  wraith: [{item:'crystal',weight:32},{item:'redstone',weight:28,amount:2},{item:'healingPotion',weight:10},{item:'ancientKey',weight:3}],
  skySentinel: [{item:'crystal',weight:38,amount:2},{item:'gold',weight:28,amount:2},{item:'healingPotion',weight:16},{item:'voidScale',weight:2}],
  ancientGuardian: [{item:'guardianCore',weight:60},{item:'guardianBlade',weight:15},{item:'ancientKey',weight:25}],
  voidDragon: [{item:'voidScale',weight:55,amount:2},{item:'voidChestplate',weight:20},{item:'crystal',weight:25,amount:6}]
});

function defaultState() {
  return { version: 5, worldSeed: 'TERRANOVA-3107', blocks: {}, profiles: {}, clans: {}, lootBoxes: {}, itemDrops: {}, levers: {}, circuitPower: {}, chestClaims: {}, worldDay: 0.28 };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    return { ...defaultState(), ...parsed, blocks: parsed.blocks || {}, profiles: parsed.profiles || {}, clans: parsed.clans || {}, lootBoxes: parsed.lootBoxes || {}, itemDrops: parsed.itemDrops || {}, levers: parsed.levers || {}, circuitPower: parsed.circuitPower || {}, chestClaims: parsed.chestClaims || {} };
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
    maxHealth: 100,
    mana: 100,
    maxMana: 100,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skills: { miner: 0, warrior: 0, vitality: 0, explorer: 0 },
    inventory: { grass: 12, dirt: 8, wood: 6, stone: 3, bread: 2, woodPickaxe: 1 },
    equipment: { helmet: null, chest: null, boots: null },
    questIndex: 0,
    questProgress: {},
    completedQuests: [],
    discoveredLandmarks: [],
    starterGranted: true,
    carriedBoxes: [],
    stats: { kills: 0, mined: 0, crafted: 0, placed: 0, bosses: 0, chests: 0, discoveries: 0, deaths: 0 },
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
    maxHealth: profile.maxHealth,
    mana: profile.mana,
    maxMana: profile.maxMana,
    level: profile.level,
    xp: profile.xp,
    xpNext: 100 + profile.level * 75,
    skillPoints: profile.skillPoints || 0,
    skills: profile.skills || { miner: 0, warrior: 0, vitality: 0, explorer: 0 },
    skillDefinitions: SKILLS,
    inventory: profile.inventory,
    equipment: profile.equipment,
    questIndex: profile.questIndex,
    questProgress: profile.questProgress,
    completedQuests: profile.completedQuests,
    discoveredLandmarks: profile.discoveredLandmarks || [],
    landmarkTotal: LANDMARKS.length,
    stats: profile.stats,
    claimedQuests: profile.claimedQuests,
    clan: profile.clan,
    carriedBoxes: (profile.carriedBoxes || []).map(id => ({ id, owner: state.lootBoxes[id]?.owner || 'Sconosciuto' }))
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
    if (!profile.inventory[item]) {
      delete profile.inventory[item];
      for (const slot of Object.keys(profile.equipment || {})) if (profile.equipment[slot] === item) profile.equipment[slot] = null;
    }
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

const players = new Map();
const monsters = new Map();
const dragons = new Map();

const MONSTER_KINDS = {
  slime: { hp: 26, damage: 5, speed: 1.05, coins: [5, 11], drop: 'coal' },
  boar: { hp: 42, damage: 8, speed: 1.65, coins: [8, 15], drop: 'iron' },
  golem: { hp: 75, damage: 12, speed: 0.66, coins: [16, 27], drop: 'gold' },
  wraith: { hp: 52, damage: 10, speed: 1.2, coins: [13, 22], drop: 'crystal' },
  skySentinel: { hp: 105, damage: 14, speed: .72, coins: [28, 44], drop: 'crystal', sky: true, xp: 55 },
  ancientGuardian: { hp: 350, damage: 18, speed: .62, coins: [150, 200], drop: 'guardianCore', boss: true, xp: 280 },
  voidDragon: { hp: 600, damage: 23, speed: 1.08, coins: [300, 400], drop: 'voidScale', boss: true, xp: 540 }
};

function maxHealthFor(profile) {
  return 100 + (Math.max(1, profile.level || 1) - 1) * 5 + (profile.skills?.vitality || 0) * 10;
}

function rollMonsterLoot(kind, luck = 0, random = Math.random) {
  const table = LOOT_TABLES[kind] || [];
  if (!table.length) return null;
  const boss = Boolean(MONSTER_KINDS[kind]?.boss);
  if (!boss && random() > Math.min(.94, .72 + luck * .05)) return null;
  const adjusted = table.map(entry => ({ ...entry, adjustedWeight: entry.weight * (1 + luck * (ITEM_RARITY[entry.item] ? .14 : .025)) }));
  const total = adjusted.reduce((sum, entry) => sum + entry.adjustedWeight, 0);
  let roll = random() * total;
  const selected = adjusted.find(entry => (roll -= entry.adjustedWeight) <= 0) || adjusted.at(-1);
  return { item: selected.item, amount: selected.amount || 1, rarity: ITEM_RARITY[selected.item] || 'common' };
}

function randomWorldPosition(minDistance = 10, center = { x: 0, z: 0 }) {
  let x;
  let z;
  do {
    x = Math.max(-WORLD_LIMIT + 5, Math.min(WORLD_LIMIT - 5, Math.floor(center.x + (Math.random() - 0.5) * 72)));
    z = Math.max(-WORLD_LIMIT + 5, Math.min(WORLD_LIMIT - 5, Math.floor(center.z + (Math.random() - 0.5) * 72)));
  } while (Math.hypot(x - center.x, z - center.z) < minDistance);
  return { x, y: terrainHeight(x, z) + 1.1, z };
}

function spawnMonster(kind, center) {
  const stats = MONSTER_KINDS[kind];
  const position = randomWorldPosition(9, center);
  const monster = { id: randomId('mob'), kind, ...position, hp: stats.hp, maxHp: stats.hp, yaw: Math.random() * Math.PI * 2, target: null, lastAttack: 0 };
  monsters.set(monster.id, monster);
  return monster;
}

function spawnBoss(kind) {
  const stats = MONSTER_KINDS[kind];
  const position = kind === 'ancientGuardian'
    ? { x: -24, y: terrainHeight(-24, -24) - 3.8, z: -24 }
    : { x: 58, y: terrainHeight(58, -54) + 1.3, z: -54 };
  const monster = { id: `boss_${kind}`, kind, ...position, hp: stats.hp, maxHp: stats.hp, yaw: 0, target: null, lastAttack: 0, boss: true };
  monsters.set(monster.id, monster);
  return monster;
}

function spawnSkySentinel(index = 0) {
  const stats = MONSTER_KINDS.skySentinel;
  const homes = [{ x:101,y:24,z:72 },{ x:107,y:24,z:75 },{ x:-101,y:24,z:88 },{ x:-107,y:24,z:85 }],position=homes[index%homes.length];
  const monster={id:`sky_sentinel_${index}`,kind:'skySentinel',...position,homeY:position.y,hp:stats.hp,maxHp:stats.hp,yaw:0,target:null,lastAttack:0};monsters.set(monster.id,monster);return monster;
}

function ensurePopulation() {
  const kinds = Object.keys(MONSTER_KINDS).filter(kind => !MONSTER_KINDS[kind].boss&&!MONSTER_KINDS[kind].sky);
  while ([...monsters.values()].filter(monster => !MONSTER_KINDS[monster.kind].boss&&!MONSTER_KINDS[monster.kind].sky).length < 20) spawnMonster(kinds[Math.floor(Math.random() * kinds.length)]);
  for(let index=0;index<4;index+=1)if(!monsters.has(`sky_sentinel_${index}`))spawnSkySentinel(index);
  for (const kind of ['ancientGuardian', 'voidDragon']) if (![...monsters.values()].some(monster => monster.kind === kind)) spawnBoss(kind);
  if (!dragons.size) {
    const dragonPositions = [{ x: 13, z: -15 }, { x: -22, z: 18 }];
    dragonPositions.forEach((position, index) => dragons.set(`dragon_${index + 1}`, {
      id: `dragon_${index + 1}`,
      name: index ? 'Nembofiamma' : 'Auralis',
      x: position.x,
      y: terrainHeight(position.x, position.z) + 2.8,
      z: position.z,
      yaw: index * Math.PI,
      rider: null,
      homeX: position.x,
      homeZ: position.z,
      phase: index * Math.PI,
      speed: index ? 0.19 : 0.16,
      flightRadius: index ? 12 : 9
    }));
  }
}

function updateDragonFlight(dragon, dt) {
  if (dragon.rider) return dragon;
  dragon.phase = (dragon.phase || 0) + dt * (dragon.speed || 0.16);
  const radius = dragon.flightRadius || 10;
  const homeX = Number.isFinite(dragon.homeX) ? dragon.homeX : dragon.x;
  const homeZ = Number.isFinite(dragon.homeZ) ? dragon.homeZ : dragon.z;
  const nextX = homeX + Math.cos(dragon.phase) * radius;
  const nextZ = homeZ + Math.sin(dragon.phase * 0.82) * radius;
  const ground = terrainHeight(Math.round(nextX), Math.round(nextZ));
  const altitude = 2.4 + Math.abs(Math.sin(dragon.phase * 0.47)) * 9;
  const targetY = ground + altitude;
  dragon.yaw = Math.atan2(nextX - dragon.x, nextZ - dragon.z);
  dragon.x = nextX;
  dragon.z = nextZ;
  dragon.y += (targetY - dragon.y) * Math.min(1, dt * 1.35);
  dragon.flying = dragon.y > ground + 3.2;
  return dragon;
}

function releaseDragon(dragon) {
  if (!dragon) return;
  dragon.rider = null;
  dragon.homeX = dragon.x;
  dragon.homeZ = dragon.z;
  dragon.phase = 0;
}

function groundLootBoxes() {
  return Object.values(state.lootBoxes).filter(box => !box.holder).map(box => ({ id: box.id, owner: box.owner, x: box.x, y: box.y, z: box.z, itemCount: Object.values(box.items || {}).reduce((sum, amount) => sum + amount, 0), coins: box.coins || 0 }));
}

function groundItemDrops() {
  return Object.values(state.itemDrops);
}

function recalculateCircuits() {
  const powered = {};
  const queue = Object.entries(state.levers).filter(([, active]) => active).map(([key]) => key);
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const currentType = state.blocks[current];
    if (!CIRCUIT_TYPES.has(currentType)) continue;
    powered[current] = true;
    const [x, y, z] = current.split(',').map(Number);
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]) {
      const neighbor = `${x + dx},${y + dy},${z + dz}`;
      if (CIRCUIT_TYPES.has(state.blocks[neighbor]) && !visited.has(neighbor)) queue.push(neighbor);
    }
  }
  state.circuitPower = powered;
  io?.emit?.('circuitState', powered);
  return powered;
}

function createDeathBox(player, profile) {
  const position = { x: player.x, y: Math.max(1, player.y - EYE_HEIGHT_SAFE), z: player.z };
  for (const [index, boxId] of (profile.carriedBoxes || []).entries()) {
    const carried = state.lootBoxes[boxId];
    if (carried) Object.assign(carried, position, { x: position.x + index * .35, holder: null });
  }
  const items = { ...profile.inventory };
  delete items.lootBox;
  const box = { id: randomId('loot'), owner: profile.name, ...position, items, coins: profile.coins || 0, holder: null, createdAt: Date.now() };
  state.lootBoxes[box.id] = box;
  profile.inventory = {};
  profile.equipment = { helmet: null, chest: null, boots: null };
  profile.carriedBoxes = [];
  profile.coins = 0;
  return box;
}

const EYE_HEIGHT_SAFE = 1.65;

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
recalculateCircuits();

function serializePlayers() {
  return [...players.values()].map(({ socketId, ...player }) => player);
}

function serializeClans() {
  return Object.values(state.clans).map(clan => ({ name: clan.name, leader: clan.leader, members: clan.members, treasury: clan.treasury || 0 }));
}

function sendProfile(socket, profile, message) {
  if (socket) socket.emit('profile', { ...publicProfile(profile), quests: QUESTS, message });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function validCoordinate(value) {
  return Number.isInteger(value) && value >= -WORLD_LIMIT && value <= WORLD_LIMIT;
}

function activeQuest(profile) {
  return QUESTS[profile.questIndex || 0] || null;
}

function grantXp(socket, profile, amount) {
  profile.xp += amount;
  let next = 100 + profile.level * 75;
  while (profile.xp >= next) {
    profile.xp -= next;
    profile.level += 1;
    profile.skillPoints = (profile.skillPoints || 0) + 1;
    profile.maxHealth = maxHealthFor(profile);
    profile.maxMana = 100 + (profile.level - 1) * 4;
    profile.mana = profile.maxMana;
    profile.health = profile.maxHealth;
    socket?.emit('toast', { type: 'level', text: `Livello ${profile.level}! Hai ottenuto 1 punto abilità.` });
    next = 100 + profile.level * 75;
  }
}

function advanceQuest(socket, profile, event, target = 'any', amount = 1) {
  const quest = activeQuest(profile);
  if (!quest || quest.event !== event || (quest.target !== 'any' && quest.target !== target)) return false;
  const current = Math.min(quest.goal, (profile.questProgress[quest.id] || 0) + amount);
  profile.questProgress[quest.id] = current;
  if (current < quest.goal) {
    socket?.emit('questProgress', { id: quest.id, current, goal: quest.goal });
    return true;
  }
  profile.completedQuests.push(quest.id);
  profile.questIndex += 1;
  profile.coins += quest.reward.coins || 0;
  addItems(profile, quest.reward.items || {});
  grantXp(socket, profile, quest.reward.xp || 0);
  socket?.emit('toast', { type: 'quest', text: `Missione completata: ${quest.title} · +${quest.reward.coins || 0} monete · +${quest.reward.xp || 0} XP` });
  const nextQuest = activeQuest(profile);
  if (nextQuest) socket?.emit('questUnlocked', nextQuest);
  else socket?.emit('campaignComplete', { title: 'Eroe di Terranovaland' });
  sendProfile(socket, profile);
  persistSoon();
  return true;
}

function npcDialogue(npc, profile) {
  const quest = activeQuest(profile);
  const hints = {
    elda: quest ? `La tua missione è “${quest.title}”. ${quest.description}. Ogni passo ti avvicina al cuore di Terranovaland.` : 'Hai spezzato la corruzione. Terranovaland ricorderà il tuo nome.',
    borin: 'Un buon equipaggiamento decide chi torna dal dungeon. Ferro per l’armatura, cristallo per le armi: non risparmiare sulla corazza.',
    asha: 'Le pozioni curative richiedono cristallo e pane. Portane almeno tre quando scendi nel Dungeon d’Ossidiana.',
    lyra: quest?.marker ? `Ho segnato ${quest.marker.label} sulla tua bussola. Segui l’indicatore dorato.` : 'I castelli custodiscono tesori, ma le rovine più silenziose nascondono spesso i pericoli peggiori.',
    kael: 'I draghi non sono cavalcature comuni. Offri loro un Dono per draghi e conquistane la fiducia prima di salire in quota.'
  };
  return { npc, text: hints[npc.id], quest: quest ? { title: quest.title, description: quest.description, marker: quest.marker } : null };
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
    profile.inventory ||= {};
    profile.carriedBoxes ||= [];
    profile.level ||= 1;
    profile.xp ||= 0;
    profile.maxMana ||= 100 + (profile.level - 1) * 4;
    profile.mana = Math.max(0, Math.min(profile.maxMana, Number.isFinite(profile.mana) ? profile.mana : profile.maxMana));
    profile.skillPoints ||= 0;
    profile.skills = { miner: 0, warrior: 0, vitality: 0, explorer: 0, ...(profile.skills || {}) };
    profile.maxHealth = maxHealthFor(profile);
    profile.equipment ||= { helmet: null, chest: null, boots: null };
    profile.questIndex ||= 0;
    profile.questProgress ||= {};
    profile.completedQuests ||= [];
    profile.discoveredLandmarks ||= [];
    profile.stats = { kills: 0, mined: 0, crafted: 0, placed: 0, bosses: 0, chests: 0, discoveries: 0, deaths: 0, ...(profile.stats || {}) };
    if (!profile.starterGranted) {
      if (!['woodPickaxe', 'stonePickaxe', 'ironPickaxe'].some(tool => profile.inventory[tool] > 0)) profile.inventory.woodPickaxe = 1;
      profile.starterGranted = true;
    }
    profile.health = Math.max(1, Math.min(profile.maxHealth, profile.health || profile.maxHealth));
    profile.lastSeen = Date.now();
    state.profiles[key] = profile;
    const player = { id: socket.id, socketId: socket.id, name, x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, yaw: 0, pitch: 0, health: profile.health, clan: profile.clan, mountedDragon: null, lastMoveAt: Date.now(), lastAttackAt: 0, lastDamagedAt: 0, lastRegenAt: 0, invulnerableUntil: Date.now() + 6000 };
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
      lootBoxes: groundLootBoxes(),
      itemDrops: groundItemDrops(),
      circuitPower: state.circuitPower,
      npcs: NPCS,
      chests: WORLD_CHESTS.map(chest => ({ ...chest, loot: undefined, claimed: Boolean(state.chestClaims[chest.id]?.includes(key)) })),
      landmarks: LANDMARKS.map(({ reward, ...landmark }) => landmark),
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
    const profile = state.profiles[profileKey(player.name)];
    const quest = activeQuest(profile);
    if (quest?.event === 'visit' && quest.marker && Math.hypot(player.x - quest.marker.x, player.z - quest.marker.z) <= 8) advanceQuest(socket, profile, 'visit', quest.target);
    const discovery = LANDMARKS.find(landmark => !profile.discoveredLandmarks.includes(landmark.id) && player.y >= (landmark.minY || -Infinity) && Math.hypot(player.x - landmark.x, player.z - landmark.z) <= landmark.radius);
    if (discovery) {
      profile.discoveredLandmarks.push(discovery.id);
      profile.stats.discoveries = profile.discoveredLandmarks.length;
      const explorerBonus = 1 + profile.skills.explorer * .1;
      const discoveryCoins = Math.round(discovery.reward.coins * explorerBonus);
      const discoveryXp = Math.round(discovery.reward.xp * explorerBonus);
      profile.coins += discoveryCoins;
      grantXp(socket, profile, discoveryXp);
      socket.emit('landmarkDiscovered', { id: discovery.id, name: discovery.name, type: discovery.type, coins: discoveryCoins, xp: discoveryXp, current: profile.discoveredLandmarks.length, total: LANDMARKS.length });
      sendProfile(socket, profile);
      persistSoon();
    }
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
    if (!player || !profile || !BLOCK_TYPES.has(block) || !validCoordinate(position.x) || !validCoordinate(position.z) || !Number.isInteger(position.y) || position.y < 0 || position.y > 30) return;
    if (distance(player, position) > 7 || position.y === 0) return;
    if (['stone', 'coal', 'iron', 'gold', 'crystal', 'obsidian', 'redstone'].includes(block)) {
      const tools = ['woodPickaxe', 'stonePickaxe', 'ironPickaxe'];
      if (!tools.some(tool => profile.inventory[tool])) return socket.emit('toast', { type: 'danger', text: 'Ti serve un piccone per scavare questo materiale.' });
    }
    const blockKey = `${position.x},${position.y},${position.z}`;
    if (state.blocks[blockKey] === 0) return;
    state.blocks[blockKey] = 0;
    if (CIRCUIT_TYPES.has(block)) { delete state.levers[blockKey]; recalculateCircuits(); }
    const boostedMining = Boolean(player.miningBoost);
    const miningAmount = boostedMining || Math.random() < (profile.skills.miner || 0) * .12 ? 2 : 1;
    player.miningBoost = false;
    addItems(profile, { [block]: miningAmount });
    if (miningAmount > 1) socket.emit('toast', { type: 'skill', text: `Minatore: hai estratto 2× ${block}.` });
    profile.stats.mined += 1;
    advanceQuest(socket, profile, 'mine', block);
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
    if (!validCoordinate(position.x) || !validCoordinate(position.z) || !Number.isInteger(position.y) || position.y < 1 || position.y > 30 || distance(player, position) > 7) return;
    if (Math.hypot(position.x - SPAWN.x, position.z - SPAWN.z) < 3.5) return socket.emit('toast', { type: 'danger', text: 'La piazza dello spawn è protetta.' });
    const blockKey = `${position.x},${position.y},${position.z}`;
    state.blocks[blockKey] = type;
    if (type === 'lever') state.levers[blockKey] = false;
    if (CIRCUIT_TYPES.has(type)) recalculateCircuits();
    removeItems(profile, { [type]: 1 });
    profile.stats.placed += 1;
    advanceQuest(socket, profile, 'place', type);
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
    if (held === 'guardianBlade' && profile.inventory.guardianBlade) damage = 52;
    damage += Math.floor((profile.level - 1) * 1.5) + (profile.skills.warrior || 0) * 3;
    if (player.powerStrike) { damage += 18 + (profile.skills.warrior || 0) * 6; player.powerStrike = false; }
    monster.hp -= damage;
    monster.target = player.id;
    io.emit('monsterHit', { id: monster.id, hp: monster.hp, damage, by: player.name });
    if (monster.hp <= 0) {
      const stats = MONSTER_KINDS[monster.kind];
      const earned = Math.floor(stats.coins[0] + Math.random() * (stats.coins[1] - stats.coins[0] + 1));
      profile.coins += earned;
      profile.stats.kills += 1;
      if (stats.boss) profile.stats.bosses += 1;
      const loot = rollMonsterLoot(monster.kind, profile.skills.explorer || 0);
      if (loot) {
        const drop = { id: randomId('item'), item: loot.item, amount: loot.amount, rarity: loot.rarity, x: monster.x, y: monster.y + .25, z: monster.z, droppedBy: monster.kind, createdAt: Date.now() };
        state.itemDrops[drop.id] = drop;
        io.emit('itemDrops', groundItemDrops());
        socket.emit('lootDropped', { item: loot.item, amount: loot.amount, rarity: loot.rarity });
      }
      monsters.delete(monster.id);
      io.emit('monsterDefeated', { id: monster.id, by: player.name, coins: earned });
      socket.emit('toast', { type: 'coin', text: `Creatura sconfitta · +${earned} monete` });
      grantXp(socket, profile, stats.xp || (6 + Math.floor(stats.hp / 12)));
      advanceQuest(socket, profile, 'kill', monster.kind);
      const respawnCenter = { x: player.x, z: player.z };
      const respawnDelay = stats.boss ? 180_000 : 5000;
      setTimeout(() => { const next = stats.boss ? spawnBoss(monster.kind) : stats.sky ? spawnSkySentinel(Number(monster.id.split('_').at(-1)) || 0) : spawnMonster(monster.kind, respawnCenter); io.emit('monsterSpawned', next); }, respawnDelay);
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
    advanceQuest(socket, profile, 'craft', String(recipeId));
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
    if (!profile || !player || !['bread', 'healingPotion'].includes(item) || !(profile.inventory[item] > 0) || profile.health >= profile.maxHealth) return;
    removeItems(profile, { [item]: 1 });
    profile.health = Math.min(profile.maxHealth, profile.health + (item === 'healingPotion' ? 65 : 28));
    player.health = profile.health;
    sendProfile(socket, profile, 'Energia recuperata');
    socket.emit('health', profile.health);
    persistSoon();
  });

  socket.on('equipItem', item => {
    const profile = key && state.profiles[key];
    item = cleanText(item, 32);
    if (!profile || !(profile.inventory[item] > 0)) return;
    const slot = item.includes('Helmet') ? 'helmet' : item.includes('Chestplate') ? 'chest' : item.includes('Boots') ? 'boots' : null;
    if (!slot) return;
    profile.equipment[slot] = profile.equipment[slot] === item ? null : item;
    sendProfile(socket, profile, profile.equipment[slot] ? `${item} indossato` : `${item} rimosso`);
    persistSoon();
  });

  socket.on('unlockSkill', skillId => {
    const profile = key && state.profiles[key];
    skillId = cleanText(skillId, 20);
    const definition = SKILLS[skillId];
    if (!profile || !definition || profile.skillPoints < 1 || (profile.skills[skillId] || 0) >= definition.max) return;
    profile.skillPoints -= 1;
    profile.skills[skillId] = (profile.skills[skillId] || 0) + 1;
    if (skillId === 'vitality') {
      profile.maxHealth = maxHealthFor(profile);
      profile.health = Math.min(profile.maxHealth, profile.health + 10);
      const player = players.get(socket.id);
      if (player) player.health = profile.health;
    }
    sendProfile(socket, profile, `${definition.name} migliorata al grado ${profile.skills[skillId]}`);
    persistSoon();
  });

  socket.on('useAbility', abilityId => {
    const profile = key && state.profiles[key];
    const player = players.get(socket.id);
    abilityId = cleanText(abilityId, 20);
    if (!profile || !player || profile.health <= 0) return;
    const definitions = {
      warrior: { cost: 25, required: 'warrior', cooldown: 3000 },
      vitality: { cost: 35, required: 'vitality', cooldown: 10000 },
      miner: { cost: 20, required: 'miner', cooldown: 2500 },
      explorer: { cost: 25, required: 'explorer', cooldown: 8000 }
    };
    const ability = definitions[abilityId];
    const now = Date.now();
    player.abilityCooldowns ||= {};
    if (!ability || !(profile.skills[ability.required] > 0) || profile.mana < ability.cost || now < (player.abilityCooldowns[abilityId] || 0)) return socket.emit('toast', { type:'danger', text:'Abilità non disponibile: controlla mana, grado e recupero.' });
    profile.mana -= ability.cost;
    player.abilityCooldowns[abilityId] = now + ability.cooldown;
    if (abilityId === 'warrior') player.powerStrike = true;
    if (abilityId === 'miner') player.miningBoost = true;
    if (abilityId === 'explorer') player.hasteUntil = now + 6000;
    if (abilityId === 'vitality') {
      const recovered = 24 + profile.skills.vitality * 6;
      profile.health = Math.min(profile.maxHealth, profile.health + recovered);
      player.health = profile.health;
      socket.emit('health', profile.health);
    }
    socket.emit('abilityActivated', { id: abilityId, duration: abilityId === 'explorer' ? 6000 : 0 });
    sendProfile(socket, profile);
    persistSoon();
  });

  socket.on('toggleCircuit', data => {
    const player = players.get(socket.id);
    const position = { x: Number(data?.x), y: Number(data?.y), z: Number(data?.z) };
    const blockKey = `${position.x},${position.y},${position.z}`;
    if (!player || state.blocks[blockKey] !== 'lever' || distance(player, position) > 5) return;
    state.levers[blockKey] = !state.levers[blockKey];
    recalculateCircuits();
    if (state.levers[blockKey]) advanceQuest(socket, state.profiles[key], 'circuit', 'lever');
    io.emit('leverChanged', { ...position, active: state.levers[blockKey], by: player.name });
    persistSoon();
  });

  socket.on('talkNpc', npcId => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const npc = NPCS.find(item => item.id === String(npcId));
    if (!player || !profile || !npc || distance(player, npc) > 5) return;
    socket.emit('npcDialogue', npcDialogue(npc, profile));
  });

  socket.on('openChest', chestId => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const chest = WORLD_CHESTS.find(item => item.id === String(chestId));
    if (!player || !profile || !chest || distance(player, chest) > 5) return;
    state.chestClaims[chest.id] ||= [];
    if (state.chestClaims[chest.id].includes(key)) return socket.emit('toast', { type: 'danger', text: 'Hai già raccolto questo tesoro.' });
    state.chestClaims[chest.id].push(key);
    profile.coins += chest.loot.coins;
    addItems(profile, chest.loot.items);
    profile.stats.chests += 1;
    grantXp(socket, profile, 45);
    sendProfile(socket, profile);
    socket.emit('chestOpened', { id: chest.id, name: chest.name, coins: chest.loot.coins, items: chest.loot.items });
    persistSoon();
  });

  socket.on('interactLootBox', boxId => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const box = state.lootBoxes[String(boxId)];
    if (!player || !profile || !box || box.holder || distance(player, box) > 4) return;
    if (profileKey(box.owner) === key) {
      addItems(profile, box.items || {});
      profile.coins += box.coins || 0;
      delete state.lootBoxes[box.id];
      socket.emit('toast', { type: 'quest', text: 'Hai recuperato tutto ciò che avevi perso.' });
    } else {
      box.holder = profile.name;
      profile.carriedBoxes ||= [];
      profile.carriedBoxes.push(box.id);
      addItems(profile, { lootBox: 1 });
      socket.emit('toast', { type: 'quest', text: `Hai raccolto il box di ${box.owner}. Riportaglielo!` });
    }
    sendProfile(socket, profile);
    io.emit('lootBoxes', groundLootBoxes());
    persistSoon();
  });

  socket.on('dropLootBox', data => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const boxId = cleanText(data?.id || profile?.carriedBoxes?.[0], 40);
    const box = state.lootBoxes[boxId];
    const position = { x: Number(data?.x), y: Number(data?.y), z: Number(data?.z) };
    if (!player || !profile || !box || box.holder !== profile.name || !Object.values(position).every(Number.isFinite) || distance(player, position) > 6) return;
    Object.assign(box, position, { holder: null });
    profile.carriedBoxes = (profile.carriedBoxes || []).filter(id => id !== boxId);
    removeItems(profile, { lootBox: 1 });
    sendProfile(socket, profile, `Box di ${box.owner} posato a terra`);
    io.emit('lootBoxes', groundLootBoxes());
    persistSoon();
  });

  socket.on('dropItem', data => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const item = cleanText(data?.item, 32);
    const position = { x: Number(data?.x), y: Number(data?.y), z: Number(data?.z) };
    if (!player || !profile || item === 'lootBox' || !(profile.inventory[item] > 0) || !Object.values(position).every(Number.isFinite) || distance(player, position) > 6) return;
    removeItems(profile, { [item]: 1 });
    const drop = { id: randomId('item'), item, amount: 1, ...position, droppedBy: profile.name, createdAt: Date.now() };
    state.itemDrops[drop.id] = drop;
    sendProfile(socket, profile);
    io.emit('itemDrops', groundItemDrops());
    persistSoon();
  });

  socket.on('pickupItem', dropId => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const drop = state.itemDrops[String(dropId)];
    if (!player || !profile || !drop || distance(player, drop) > 4) return;
    addItems(profile, { [drop.item]: drop.amount || 1 });
    delete state.itemDrops[drop.id];
    sendProfile(socket, profile, `${drop.item} raccolto`);
    io.emit('itemDrops', groundItemDrops());
    persistSoon();
  });

  socket.on('giftItem', data => {
    const player = players.get(socket.id);
    const profile = key && state.profiles[key];
    const recipient = players.get(String(data?.targetId));
    const item = cleanText(data?.item, 32);
    if (!player || !profile || !recipient || item === 'lootBox' || !(profile.inventory[item] > 0) || distance(player, recipient) > 7) return socket.emit('toast', { type: 'danger', text: 'Il giocatore deve essere vicino per ricevere il regalo.' });
    const recipientProfile = state.profiles[profileKey(recipient.name)];
    if (!recipientProfile) return;
    removeItems(profile, { [item]: 1 }); addItems(recipientProfile, { [item]: 1 });
    sendProfile(socket, profile, `${item} regalato a ${recipient.name}`);
    sendProfile(io.sockets.sockets.get(recipient.socketId), recipientProfile, `${profile.name} ti ha regalato: ${item}`);
    persistSoon();
  });

  socket.on('mountDragon', dragonId => {
    const profile = key && state.profiles[key];
    const player = players.get(socket.id);
    const dragon = dragons.get(String(dragonId));
    if (!profile || !player || !dragon) return;
    if (player.mountedDragon) {
      const current = dragons.get(player.mountedDragon);
      releaseDragon(current);
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
    advanceQuest(socket, profile, 'mount', 'dragon');
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
    if (profile.clan) advanceQuest(socket, profile, 'clan', 'any');
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
    Object.assign(player, SPAWN, { health: profile.maxHealth, mountedDragon: null, invulnerableUntil: Date.now() + 8000, lastDamagedAt: 0 });
    profile.health = profile.maxHealth;
    socket.emit('respawned', { ...SPAWN, health: profile.maxHealth });
    sendProfile(socket, profile);
    persistSoon();
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (!player) return;
    if (player.mountedDragon) {
      const dragon = dragons.get(player.mountedDragon);
      releaseDragon(dragon);
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
let lastMonsterBalance = 0;
function updateWorld() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - previousTick) / 1000);
  previousTick = now;
  state.worldDay = (state.worldDay + dt / 720) % 1;

  for (const monster of monsters.values()) {
    let closest = null;
    let closestDistance = 16;
    const stats = MONSTER_KINDS[monster.kind];
    for (const player of players.values()) {
      const currentDistance = Math.hypot(player.x - monster.x, player.z - monster.z);
      if (stats.sky && Math.abs(player.y - monster.y) > 6) continue;
      if (currentDistance < closestDistance && player.health > 0 && !player.mountedDragon) {
        closest = player;
        closestDistance = currentDistance;
      }
    }
    if (closest) {
      const angle = Math.atan2(closest.x - monster.x, closest.z - monster.z);
      monster.yaw = angle;
      if (closestDistance > 1.45) {
        monster.x += Math.sin(angle) * stats.speed * dt;
        monster.z += Math.cos(angle) * stats.speed * dt;
        const ground = terrainHeight(Math.round(monster.x), Math.round(monster.z));
        monster.y = monster.kind === 'ancientGuardian' ? terrainHeight(-24, -24) - 3.8 : stats.sky ? (monster.homeY || 24) + Math.sin(now / 700 + monster.x) * .45 : ground + (monster.kind === 'voidDragon' ? 5 + Math.sin(now / 650) * 1.2 : 1.1);
      } else if (now - monster.lastAttack > 1250) {
        monster.lastAttack = now;
        const profile = state.profiles[profileKey(closest.name)];
        const defenseValue = item => ({ frostHelmet: 6, voidChestplate: 13, swiftBoots: 4 }[item] || (item ? 3 : 0));
        const defense = profile ? defenseValue(profile.equipment?.helmet) + (profile.equipment?.chest === 'ironChestplate' ? 7 : defenseValue(profile.equipment?.chest)) + defenseValue(profile.equipment?.boots) : 0;
        const receivedDamage = Math.max(2, stats.damage - defense);
        if (now < (closest.invulnerableUntil || 0)) continue;
        closest.health = Math.max(0, closest.health - receivedDamage);
        closest.lastDamagedAt = now;
        if (profile) profile.health = closest.health;
        io.to(closest.socketId).emit('health', closest.health);
        io.to(closest.socketId).emit('playerDamaged', { amount: receivedDamage, source: monster.kind });
        if (closest.health === 0 && profile) {
          profile.stats.deaths += 1;
          createDeathBox(closest, profile);
          sendProfile(io.sockets.sockets.get(closest.socketId), profile);
          io.emit('lootBoxes', groundLootBoxes());
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
  for (const player of players.values()) {
    const profile = state.profiles[profileKey(player.name)];
    if (!profile || player.health <= 0) continue;
    if (player.health < profile.maxHealth && now - (player.lastDamagedAt || 0) >= 8000 && now - (player.lastRegenAt || 0) >= 2500) {
      player.lastRegenAt = now;
      const recovered = 2 + Math.floor((profile.skills?.vitality || 0) / 2);
      player.health = Math.min(profile.maxHealth, player.health + recovered);
      profile.health = player.health;
      io.to(player.socketId).emit('health', player.health);
    }
    if (profile.mana < profile.maxMana && now - (player.lastManaRegenAt || 0) >= 1800) {
      player.lastManaRegenAt = now;
      profile.mana = Math.min(profile.maxMana, profile.mana + 3);
      io.to(player.socketId).emit('mana', { mana: profile.mana, maxMana: profile.maxMana });
    }
  }
  if (now - lastMonsterBalance > 5000 && players.size) {
    lastMonsterBalance = now;
    for (const player of players.values()) {
      const nearby = [...monsters.values()].filter(monster => Math.hypot(monster.x - player.x, monster.z - player.z) < 34).length;
      if (nearby >= 3) continue;
      const candidate = [...monsters.values()].find(monster => !MONSTER_KINDS[monster.kind].boss && !MONSTER_KINDS[monster.kind].sky && [...players.values()].every(other => Math.hypot(monster.x - other.x, monster.z - other.z) > 55));
      if (candidate) Object.assign(candidate, randomWorldPosition(12, player), { target: null });
    }
  }
  for (const dragon of dragons.values()) updateDragonFlight(dragon, dt);
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

module.exports = { server, terrainHeight, biomeAt, SPAWN, RECIPES, SHOP, QUESTS, LANDMARKS, SKILLS, LOOT_TABLES, freshProfile, activeQuest, advanceQuest, rollMonsterLoot, maxHealthFor, updateDragonFlight, createDeathBox };
