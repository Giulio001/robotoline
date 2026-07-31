import * as THREE from 'three';
import { PointerLockControls } from '/vendor/PointerLockControls.js';

const socket = window.io({ transports: ['websocket', 'polling'] });
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const WORLD_LIMIT = 512;
const CHUNK_SIZE = 16;
const WATER_LEVEL = 6;
const EYE_HEIGHT = 1.65;
const DEFAULT_SETTINGS = Object.freeze({ fov: 88, sensitivity: 1, volume: 70, quality: 'high', bob: true, ambient: true });

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('terranovaland-settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

let settings = loadSettings();

const ITEM_INFO = {
  grass: ['Erba', '#4e9b55', ''], dirt: ['Terra', '#79533a', ''], stone: ['Pietra', '#777d7d', ''], sand: ['Sabbia', '#cfbd78', ''],
  wood: ['Legno', '#7a5731', ''], leaves: ['Foglie', '#3d7e49', ''], planks: ['Assi', '#a77b49', ''], brick: ['Mattoni', '#9a5547', ''],
  obsidian: ['Ossidiana', '#35294d', ''], crystal: ['Cristallo', '#38a6c6', '◆'], coal: ['Carbone', '#303436', ''], iron: ['Ferro', '#a9aba5', ''],
  gold: ['Oro', '#d3a836', ''], redstone: ['Pietrarossa', '#a92f35', ''], redstoneWire: ['Circuito', '#8e252b', '⌁'], lever: ['Leva', '#86715a', '⌇'], lamp: ['Lampada', '#d5a842', '☼'], piston: ['Pistone', '#92816b', '↥'], snow: ['Neve', '#dbe8e8', ''], torch: ['Torcia', '#d88f35', '♨'], bread: ['Pane', '#b97835', '◒'], lootBox: ['Box smarrito', '#b98442', '▣'],
  woodPickaxe: ['Piccone di legno', '', '⚒'], stonePickaxe: ['Piccone di pietra', '', '⚒'], ironPickaxe: ['Piccone di ferro', '', '⚒'],
  stoneSword: ['Spada di pietra', '', '⚔'], crystalSword: ['Spada di cristallo', '', '⚔'], dragonTreat: ['Dono per draghi', '', '✦']
};
const PLACEABLE = new Set(['grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'planks', 'brick', 'obsidian', 'crystal', 'coal', 'iron', 'gold', 'redstone', 'redstoneWire', 'lever', 'lamp', 'piston', 'snow', 'torch']);
const MOB_LABELS = { slime: 'Melma delle radici', boar: 'Cinghiale roccioso', golem: 'Golem antico', wraith: 'Spettro del crepuscolo' };

let scene, camera, renderer, controls, clock, sun, hemiLight, stars, skyDome, sunDisc, moonDisc;
let worldGroup, entityGroup, dragonGroup, selectionBox, crackBox, viewModel;
let worldReady = false;
let gameStarted = false;
let panelOpen = false;
let dead = false;
let profile = null;
let recipes = {};
let shop = {};
let clans = [];
let self = null;
let spawn = null;
let worldDay = 0.25;
let overrides = {};
let circuitPower = {};
let blockMeshes = [];
let currentTarget = null;
let nearbyDragon = null;
let mountedDragon = null;
let selectedSlot = 0;
let hotbarItems = ['woodPickaxe', 'grass', 'dirt', 'wood', 'stone', 'bread', null, null, null];
let rebuildTimer = null;
let renderedChunkX = null;
let renderedChunkZ = null;
let lastMoveSent = 0;
let lastAction = 0;
let miningAction = null;
let viewModelSwing = 0;
let audioContext = null;
let masterGain = null;
let ambientTimer = null;
const clouds = [];

const remotePlayers = new Map();
const mobs = new Map();
const dragons = new Map();
const lootBoxes = new Map();
const itemDrops = new Map();
const keys = new Set();
const velocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
raycaster.far = 6;
const chunkFeatureCache = new Map();

function fract(value) { return value - Math.floor(value); }
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
function worldHash(x, y, z = 0) { return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123); }
function keyOf(x, y, z) { return `${x},${y},${z}`; }

function isTreeOrigin(x, z) {
  const h = terrainHeight(x, z);
  return Math.hypot(x, z) > 7 && h > WATER_LEVEL && h < 12 && worldHash(x, z, 19) > 0.965;
}

function chunkFeature(chunkX, chunkZ) {
  const cacheKey=`${chunkX},${chunkZ}`;if(chunkFeatureCache.has(cacheKey))return chunkFeatureCache.get(cacheKey);
  if (chunkX === 0 && chunkZ === 0) return null;
  let type = null;
  if (chunkX === 1 && chunkZ === 1) type = 'castle';
  else if (chunkX === -2 && chunkZ === -2) type = 'dungeon';
  else {
    const chance = worldHash(chunkX, chunkZ, 77);
    if (chance < .7){chunkFeatureCache.set(cacheKey,null);return null}
    type = chance > .91 ? 'tower' : chance > .81 ? 'ruin' : 'shrine';
  }
  const x = chunkX * 16 + 8 + Math.floor((worldHash(chunkX, 11, chunkZ) - .5) * 4);
  const z = chunkZ * 16 + 8 + Math.floor((worldHash(chunkZ, 29, chunkX) - .5) * 4);
  const feature={ type, x, z, base: terrainHeight(x, z) };chunkFeatureCache.set(cacheKey,feature);return feature;
}

function structurePart(feature, x, y, z) {
  const dx=x-feature.x,dz=z-feature.z,ax=Math.abs(dx),az=Math.abs(dz),base=feature.base;
  if(feature.type==='castle'&&ax<=7&&az<=7&&y>=base&&y<=base+9){
    if(y===base)return{handled:true,type:'brick'};
    const gate=dz===-7&&ax<=1&&y<=base+3;
    if(gate)return{handled:true,type:null};
    const tower=ax>=5&&az>=5;
    if(tower&&(ax===7||ax===5||az===7||az===5)&&y<=base+8)return{handled:true,type:y===base+8?'gold':'brick'};
    const wall=(ax===7||az===7)&&y<=base+5;
    if(wall)return{handled:true,type:'brick'};
    if(y===base+6&&(ax===7||az===7)&&(Math.abs(dx+dz)%2===0))return{handled:true,type:'stone'};
    if(y===base+1&&((dx===0&&az<=4)||(dz===0&&ax<=4)))return{handled:true,type:'planks'};
    return{handled:true,type:null};
  }
  if(feature.type==='dungeon'&&ax<=6&&az<=6&&y>=base-5&&y<=base+4){
    if(y===base-5)return{handled:true,type:'obsidian'};
    if(y<base){
      if(ax===6||az===6)return{handled:true,type:'brick'};
      const depth=base-y;if(dx===2&&dz===2-depth)return{handled:true,type:'stone'};
      if(dx===0&&dz===0&&y===base-4)return{handled:true,type:'crystal'};
      return{handled:true,type:null};
    }
    if(y===base)return{handled:true,type:(ax===6||az===6)?'obsidian':null};
    const gate=dz===-6&&ax<=1&&y<=base+2;
    if(gate)return{handled:true,type:null};
    if((ax===6||az===6)&&y<=base+3)return{handled:true,type:(dx+dz+y)%3===0?'obsidian':'brick'};
    return{handled:true,type:null};
  }
  if(feature.type==='tower'&&ax<=3&&az<=3&&y>=base&&y<=base+8){
    if(y===base)return{handled:true,type:'stone'};
    if(dz===-3&&dx===0&&y<=base+2)return{handled:true,type:null};
    if((ax===3||az===3)&&y<=base+7)return{handled:true,type:y===base+7?'gold':'brick'};
    if(y===base+8&&(ax===3||az===3)&&(Math.abs(dx+dz)%2===0))return{handled:true,type:'stone'};
    return{handled:true,type:null};
  }
  if(feature.type==='ruin'&&ax<=5&&az<=5&&y>=base&&y<=base+4){
    if(y===base&&((ax<=1&&az<=1)||ax===5||az===5))return{handled:true,type:'stone'};
    if((ax===5||az===5)&&y<=base+1+Math.floor(worldHash(x,z,6)*3)&&!(dz===-5&&ax<2))return{handled:true,type:'brick'};
    if((dx===-3&&dz===-3||dx===3&&dz===3)&&y<=base+4)return{handled:true,type:'obsidian'};
    return{handled:true,type:null};
  }
  if(feature.type==='shrine'&&ax<=4&&az<=4&&y>=base&&y<=base+6){
    if(y===base&&ax<=3&&az<=3)return{handled:true,type:'snow'};
    if((ax===3&&az===3)&&y<=base+5)return{handled:true,type:'crystal'};
    if(dx===0&&dz===0&&y===base+1)return{handled:true,type:'gold'};
    return{handled:true,type:null};
  }
  return{handled:false,type:null};
}

function structureBlock(x,y,z){
  const chunkX=Math.floor(x/16),chunkZ=Math.floor(z/16);
  for(let cx=chunkX-1;cx<=chunkX+1;cx++)for(let cz=chunkZ-1;cz<=chunkZ+1;cz++){
    const feature=chunkFeature(cx,cz);if(!feature)continue;const part=structurePart(feature,x,y,z);if(part.handled)return part;
  }
  return{handled:false,type:null};
}

function generatedBlock(x, y, z) {
  if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT || y < 0 || y > 28) return null;
  const structure=structureBlock(x,y,z);if(structure.handled)return structure.type;
  const height = terrainHeight(x, z);
  if (y <= height) {
    if (y === 0) return 'obsidian';
    if (y === height) return height >= 11 ? 'snow' : height <= WATER_LEVEL ? 'sand' : 'grass';
    if (height - y <= 2) return height <= WATER_LEVEL ? 'sand' : 'dirt';
    const ore = worldHash(x, y, z);
    if (y < 5 && ore > 0.972) return 'crystal';
    if (y < 7 && ore > 0.95) return 'gold';
    if (y < 9 && ore > 0.925) return 'iron';
    if (y < 10 && ore > 0.895) return 'redstone';
    if (ore > 0.88) return 'coal';
    return 'stone';
  }
  if (y <= WATER_LEVEL) return 'water';

  for (let tx = x - 2; tx <= x + 2; tx++) {
    for (let tz = z - 2; tz <= z + 2; tz++) {
      if (!isTreeOrigin(tx, tz)) continue;
      const th = terrainHeight(tx, tz);
      if (x === tx && z === tz && y >= th + 1 && y <= th + 4) return 'wood';
      const dy = y - (th + 4);
      const canopy = Math.abs(x - tx) + Math.abs(z - tz) + Math.abs(dy) * 1.25;
      if (dy >= -1 && dy <= 2 && canopy <= 3.7) return 'leaves';
    }
  }
  return null;
}

function getBlock(x, y, z) {
  const override = overrides[keyOf(x, y, z)];
  if (override === 0) return null;
  return override || generatedBlock(x, y, z);
}

function isSolid(type) { return Boolean(type && !['water', 'torch', 'redstoneWire', 'lever'].includes(type)); }

function texture(colors, spots = 35) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, 32, 32);
  for (let i = 0; i < spots; i++) {
    ctx.fillStyle = colors[1 + (i % (colors.length - 1))];
    const size = 1 + (i % 3);
    ctx.fillRect(Math.floor(worldHash(i, spots) * 31), Math.floor(worldHash(spots, i) * 31), size, size);
  }
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.magFilter = THREE.NearestFilter;
  result.minFilter = THREE.NearestMipmapLinearFilter;
  return result;
}

function buildMaterials() {
  const palettes = {
    grass: ['#4e8f48', '#3f7c3e', '#67a85b'], dirt: ['#765238', '#65432f', '#916342'], stone: ['#777c7c', '#676c6c', '#929797'],
    sand: ['#cbbc79', '#b7a968', '#dfcf8d'], wood: ['#75502d', '#59391e', '#96673a'], leaves: ['#3d7d49', '#2e663a', '#54945c'],
    planks: ['#a97b48', '#8e6338', '#c08d56'], brick: ['#965346', '#7d4138', '#b66b58'], obsidian: ['#302846', '#211c36', '#4a3c66'],
    crystal: ['#36a4c4', '#25778f', '#6ee0ea'], coal: ['#343839', '#242829', '#4a4e4f'], iron: ['#a5aaa5', '#868c88', '#c3c7c0'],
    gold: ['#d1a632', '#a9801f', '#f1ce55'], redstone: ['#9e2b31', '#6f1c22', '#d64b4f'], redstoneWire: ['#6e2026', '#4b151a', '#8e2e34'], redstoneWireOn: ['#ef4148', '#b7242b', '#ff7774'],
    lever: ['#786750', '#5e503e', '#a08b6d'], leverOn: ['#be8a45', '#7c5b31', '#e5b968'], lamp: ['#746d4f', '#554f39', '#918762'], lampOn: ['#e6b94e', '#bd842b', '#ffe692'], piston: ['#867661', '#5f5548', '#a9997e'], pistonOn: ['#a89168', '#766040', '#d6bd86'],
    snow: ['#d9e7e8', '#c1d6d8', '#effafa'], torch: ['#db8a2c', '#83471d', '#ffc95c']
  };
  const materials = {};
  for (const [name, palette] of Object.entries(palettes)) {
    materials[name] = new THREE.MeshLambertMaterial({ map: texture(palette), transparent: name === 'leaves', opacity: name === 'leaves' ? 0.92 : 1, alphaTest: name === 'leaves' ? 0.15 : 0 });
  }
  for(const name of ['redstoneWireOn','lampOn'])materials[name]=new THREE.MeshStandardMaterial({map:texture(palettes[name]),color:0xffffff,emissive:name==='lampOn'?0xd79b29:0xa71920,emissiveIntensity:name==='lampOn'?1.8:1.2,roughness:.45});
  materials.water = new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0},uDeep:{value:new THREE.Color(0x15556f)},uShallow:{value:new THREE.Color(0x58c4d0)}},
    vertexShader:`uniform float uTime; varying vec3 vWorld; varying float vWave;
      void main(){ vec3 p=position; vec4 world=modelMatrix*vec4(p,1.0);
      #ifdef USE_INSTANCING
        world=modelMatrix*instanceMatrix*vec4(p,1.0);
      #endif
      float wave=sin((world.x+world.z)*2.4+uTime*1.35)*.035+sin(world.x*4.1-world.z*2.2+uTime*1.9)*.018; world.y+=wave; vWorld=world.xyz; vWave=wave; gl_Position=projectionMatrix*viewMatrix*world; }`,
    fragmentShader:'uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; varying vec3 vWorld; varying float vWave; void main(){ float ripples=sin(vWorld.x*2.8+uTime*1.7)*sin(vWorld.z*2.1-uTime*1.25); float shimmer=smoothstep(.72,1.0,ripples)*.28; float distanceFade=clamp(length(cameraPosition-vWorld)/90.0,0.0,1.0); vec3 color=mix(uShallow,uDeep,.3+distanceFade*.45)+vec3(shimmer); float alpha=.66+vWave*1.8+shimmer*.12; gl_FragColor=vec4(color,alpha); }'
  });
  return materials;
}

let blockMaterials;

function saveSettings() { localStorage.setItem('terranovaland-settings', JSON.stringify(settings)); }

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  if (masterGain) masterGain.gain.value = settings.volume / 100;
  if (settings.ambient && !ambientTimer) ambientTimer = setInterval(() => sound('wind'), 5200);
}

function tone(frequency, duration, volume = .08, type = 'sine', endFrequency = frequency) {
  if (!audioContext || !masterGain || settings.volume <= 0) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), audioContext.currentTime + duration);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(gain); gain.connect(masterGain); oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
}

function noise(duration = .12, volume = .04) {
  if (!audioContext || !masterGain || settings.volume <= 0) return;
  const length = Math.floor(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = audioContext.createBufferSource(); const gain = audioContext.createGain();
  source.buffer = buffer; gain.gain.value = volume; source.connect(gain); gain.connect(masterGain); source.start();
}

function sound(name) {
  if (!audioContext || settings.volume <= 0) return;
  if (name === 'mine') { noise(.15, .08); tone(135, .13, .045, 'square', 72); }
  else if (name === 'break') { noise(.22, .1); tone(92, .18, .045, 'triangle', 45); }
  else if (name === 'place') tone(165, .1, .055, 'square', 115);
  else if (name === 'attack') tone(260, .13, .06, 'sawtooth', 75);
  else if (name === 'hurt') { noise(.18, .06); tone(105, .2, .06, 'sawtooth', 55); }
  else if (name === 'coin') { tone(720, .11, .05, 'sine', 900); setTimeout(() => tone(1040, .14, .045), 90); }
  else if (name === 'quest') { [440, 660, 880].forEach((frequency, index) => setTimeout(() => tone(frequency, .22, .04), index * 110)); }
  else if (name === 'dragon') { tone(78, .55, .05, 'sawtooth', 42); noise(.4, .025); }
  else if (name === 'ui') tone(420, .06, .025, 'sine', 520);
  else if (name === 'wind' && settings.ambient) noise(.9, .006);
}

function applySettings(save = true) {
  if (camera) { camera.fov = Number(settings.fov); camera.far = settings.quality === 'low' ? 180 : settings.quality === 'medium' ? 260 : 340; camera.updateProjectionMatrix(); }
  if (controls) controls.pointerSpeed = Number(settings.sensitivity);
  if (renderer) {
    const ratio = settings.quality === 'low' ? 1 : settings.quality === 'medium' ? Math.min(devicePixelRatio, 1.35) : Math.min(devicePixelRatio, 1.8);
    renderer.setPixelRatio(ratio); renderer.shadowMap.enabled = settings.quality !== 'low'; renderer.setSize(innerWidth, innerHeight);
  }
  if (scene?.fog) scene.fog.density = settings.quality === 'low' ? .018 : settings.quality === 'medium' ? .012 : .0085;
  if (masterGain) masterGain.gain.value = settings.volume / 100;
  if (!settings.ambient && ambientTimer) { clearInterval(ambientTimer); ambientTimer = null; }
  if (settings.ambient && audioContext && !ambientTimer) ambientTimer = setInterval(() => sound('wind'), 5200);
  $('#fov-setting').value = settings.fov; $('#fov-output').textContent = `${settings.fov}°`;
  $('#sensitivity-setting').value = settings.sensitivity; $('#sensitivity-output').textContent = `${Number(settings.sensitivity).toFixed(1)}×`;
  $('#volume-setting').value = settings.volume; $('#volume-output').textContent = `${settings.volume}%`;
  $('#quality-setting').value = settings.quality; $('#bob-setting').checked = settings.bob; $('#ambient-setting').checked = settings.ambient;
  if(worldReady)scheduleWorldRebuild();
  if (save) saveSettings();
}

function createViewModel() {
  viewModel = new THREE.Group();
  viewModel.position.set(.56, -.48, -.82); viewModel.rotation.set(-.18, -.28, -.08); viewModel.scale.setScalar(.72);
  camera.add(viewModel); updateHeldViewModel();
}

function viewMaterial(color, emissive = 0) { return new THREE.MeshStandardMaterial({ color, emissive, roughness: .75, depthTest: false, depthWrite: false }); }

function updateHeldViewModel() {
  if (!viewModel) return;
  while (viewModel.children.length) { const child = viewModel.children.pop(); child.geometry?.dispose(); child.material?.dispose(); }
  const hand = box(.23, .42, .23, viewMaterial(0xd7a579)); hand.position.set(.13, -.1, .02); hand.rotation.z = -.18; hand.renderOrder = 100; viewModel.add(hand);
  const item = selectedItem();
  if (!item) return;
  if (item.includes('Pickaxe')) {
    const handle = box(.09, .72, .09, viewMaterial(item === 'ironPickaxe' ? 0x7c5a35 : 0x79512e)); handle.position.y = .35; handle.rotation.z = -.28;
    const head = box(.65, .12, .14, viewMaterial(item === 'woodPickaxe' ? 0x986d3e : item === 'stonePickaxe' ? 0x737b7b : 0xb5c0bd)); head.position.set(-.09, .66, 0); head.rotation.z = -.12; viewModel.add(handle, head);
  } else if (item.includes('Sword')) {
    const grip = box(.1, .45, .1, viewMaterial(0x76512d)); grip.position.y=.22; const blade=box(.13,.8,.07,viewMaterial(item==='crystalSword'?0x59d5ec:0xaeb5b2,item==='crystalSword'?0x174b58:0));blade.position.y=.78;viewModel.add(grip,blade);
  } else {
    const color = ITEM_INFO[item]?.[1] || '#b97835'; const held = box(.38, .38, .38, viewMaterial(color)); held.position.y = .32; held.rotation.set(.2,.25,.1); viewModel.add(held);
  }
  viewModel.traverse(child => { if (child.isMesh) child.renderOrder = 100; });
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x84b8cc);
  scene.fog = new THREE.FogExp2(0x92bdc7, 0.0085);
  camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 340);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  $('#game').appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, renderer.domElement);
  controls.pointerSpeed = settings.sensitivity;
  camera.position.set(spawn.x, spawn.y, spawn.z);
  scene.add(camera);
  clock = new THREE.Clock();
  worldGroup = new THREE.Group(); entityGroup = new THREE.Group(); dragonGroup = new THREE.Group();
  scene.add(worldGroup, entityGroup, dragonGroup);
  blockMaterials = buildMaterials();

  hemiLight = new THREE.HemisphereLight(0xbde4f3, 0x314128, 1.5);
  scene.add(hemiLight);
  sun = new THREE.DirectionalLight(0xffe4b0, 2.4);
  sun.position.set(30, 45, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -45; sun.shadow.camera.right = sun.shadow.camera.top = 45;
  scene.add(sun);
  createAtmosphere();
  createViewModel();

  selectionBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03)), new THREE.LineBasicMaterial({ color: 0xffd36c, transparent: true, opacity: 0.9 }));
  selectionBox.visible = false; scene.add(selectionBox);
  crackBox = new THREE.Mesh(new THREE.BoxGeometry(1.018, 1.018, 1.018), new THREE.MeshBasicMaterial({ color: 0x21180e, wireframe: true, transparent: true, opacity: 0, depthTest: true }));
  crackBox.visible = false; scene.add(crackBox);
  applySettings(false);

  controls.addEventListener('lock', () => $('#pause-overlay').classList.add('hidden'));
  controls.addEventListener('unlock', () => {
    if (gameStarted && !panelOpen && !dead && !$('#help-overlay').classList.contains('hidden')) return;
    if (gameStarted && !panelOpen && !dead) $('#pause-overlay').classList.remove('hidden');
  });
  renderer.domElement.addEventListener('mousedown', onMouseAction);
  renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
  addEventListener('resize', onResize);
}

function createAtmosphere() {
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { topColor: { value: new THREE.Color(0x3c91bf) }, bottomColor: { value: new THREE.Color(0xd8e7d5) }, nightMix: { value: 0 } },
    vertexShader: 'varying vec3 vPosition; void main(){ vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; uniform float nightMix; varying vec3 vPosition; void main(){ float h=clamp(normalize(vPosition).y*.72+.28,0.0,1.0); vec3 day=mix(bottomColor,topColor,pow(h,.72)); vec3 night=mix(vec3(.025,.045,.11),vec3(.015,.025,.07),h); gl_FragColor=vec4(mix(day,night,nightMix),1.0); }'
  });
  skyDome = new THREE.Mesh(new THREE.SphereGeometry(170, 32, 18), skyMaterial); skyDome.frustumCulled = false; skyDome.renderOrder = -1000; scene.add(skyDome);
  sunDisc = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffe3a1, fog: false }));
  moonDisc = new THREE.Mesh(new THREE.SphereGeometry(2.8, 18, 12), new THREE.MeshBasicMaterial({ color: 0xdde8ff, fog: false }));
  scene.add(sunDisc, moonDisc);
  const starGeometry = new THREE.BufferGeometry();
  const points = [];
  for (let i = 0; i < 700; i++) {
    const radius = 85 + Math.random() * 70, theta = Math.random() * Math.PI * 2, phi = Math.random() * Math.PI * 0.48;
    points.push(Math.cos(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius, Math.sin(theta) * Math.sin(phi) * radius);
  }
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xddeeff, size: 0.55, transparent: true, opacity: 0 }));
  scene.add(stars);
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false });
  for (let i = 0; i < 18; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3 + i % 3; j++) {
      const puff = new THREE.Mesh(new THREE.BoxGeometry(4 + j, 0.7 + (j % 2) * 0.4, 2.3), cloudMaterial);
      puff.position.set(j * 2.7, Math.sin(j) * 0.4, j % 2); cloud.add(puff);
    }
    cloud.position.set((Math.random() - .5) * 120, 23 + Math.random() * 11, (Math.random() - .5) * 120); cloud.userData.speed = .35 + Math.random() * .35;
    clouds.push(cloud); scene.add(cloud);
  }
}

function buildWorld() {
  const progress = $('#loading-progress');
  progress.style.width = '22%';
  const centerChunkX=Math.floor((camera?.position.x||0)/CHUNK_SIZE),centerChunkZ=Math.floor((camera?.position.z||0)/CHUNK_SIZE);
  const radius=settings.quality==='low'?24:settings.quality==='medium'?32:40;
  const startX=Math.max(-WORLD_LIMIT,centerChunkX*CHUNK_SIZE-radius),endX=Math.min(WORLD_LIMIT,centerChunkX*CHUNK_SIZE+radius);
  const startZ=Math.max(-WORLD_LIMIT,centerChunkZ*CHUNK_SIZE-radius),endZ=Math.min(WORLD_LIMIT,centerChunkZ*CHUNK_SIZE+radius);
  const positionsByType = {};
  const types = [...Object.keys(blockMaterials), 'water'];
  types.forEach(type => positionsByType[type] = []);
  for (let x = startX; x <= endX; x++) {
    for (let z = startZ; z <= endZ; z++) {
      const top = Math.max(terrainHeight(x, z) + 11, WATER_LEVEL + 1);
      for (let y = 0; y <= top; y++) {
        const type = getBlock(x, y, z);
        if (!type || !positionsByType[type]) continue;
        const exposed = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz]) => {
          const neighbor = getBlock(x + dx, y + dy, z + dz);
          return !neighbor || (type !== 'water' && neighbor === 'water') || (type === 'water' && neighbor !== 'water');
        });
        const powered=circuitPower[keyOf(x,y,z)]&&['redstoneWire','lever','lamp','piston'].includes(type);
        const renderType=powered?`${type}On`:type;
        if (exposed && positionsByType[renderType]) positionsByType[renderType].push({ x, y, z });
      }
    }
  }
  progress.style.width = '62%';
  while (worldGroup.children.length) {
    const child = worldGroup.children.pop(); child.geometry?.dispose();
  }
  blockMeshes = [];
  const matrix = new THREE.Matrix4();
  for (const [type, positions] of Object.entries(positionsByType)) {
    if (!positions.length) continue;
    const baseType=type.endsWith('On')?type.slice(0,-2):type;
    const thin=baseType==='redstoneWire',short=baseType==='lever',extended=type==='pistonOn';
    const geometry = new THREE.BoxGeometry(type === 'water' ? 1 : 1.001, type === 'water' ? .82 : thin ? .08 : short ? .3 : extended ? 1.3 : 1.001, type === 'water' ? 1 : 1.001);
    const mesh = new THREE.InstancedMesh(geometry, blockMaterials[type], positions.length);
    positions.forEach((position, index) => {
      const offset=type==='water'?-.09:thin?-.46:short?-.35:extended?.15:0;matrix.makeTranslation(position.x, position.y + offset, position.z); mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.userData.positions = positions; mesh.userData.blockType = baseType;
    mesh.receiveShadow = type !== 'water'; mesh.castShadow = ['wood', 'leaves'].includes(type);
    worldGroup.add(mesh); if (type !== 'water') blockMeshes.push(mesh);
  }
  progress.style.width = '92%';
  renderedChunkX=centerChunkX;renderedChunkZ=centerChunkZ;
  worldReady = true;
}

function scheduleWorldRebuild() {
  if(rebuildTimer)return;
  rebuildTimer = setTimeout(()=>{rebuildTimer=null;buildWorld()}, 90);
}

function simpleMaterial(color, emissive = 0) { return new THREE.MeshToonMaterial({ color, emissive }); }
function box(w, h, d, material) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

function createNameTag(text, color = '#ffffff') {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(5,12,14,.75)'; ctx.roundRect(8, 5, 240, 36, 9); ctx.fill();
  ctx.fillStyle = color; ctx.font = '600 19px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 30);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false })); sprite.scale.set(3.4, .64, 1); return sprite;
}

function createPlayerModel(player) {
  const group = new THREE.Group();
  const hue = worldHash([...player.name].reduce((a, char) => a + char.charCodeAt(0), 0), 8);
  const shirt = simpleMaterial(new THREE.Color().setHSL(hue, .45, .42));
  const skin = simpleMaterial(0xd7a579); const dark = simpleMaterial(0x263b42); const hair = simpleMaterial(0x3a2a24);
  const body = box(.62, .85, .34, shirt); body.position.y = 1.05; group.add(body);
  const head = box(.5, .5, .5, skin); head.position.y = 1.75; group.add(head);
  const hairTop = box(.52, .13, .52, hair); hairTop.position.y = 2.02; group.add(hairTop);
  const leftArm = box(.2, .78, .22, skin), rightArm = leftArm.clone(); leftArm.position.set(-.43, 1.05, 0); rightArm.position.set(.43, 1.05, 0); group.add(leftArm, rightArm);
  const leftLeg = box(.25, .78, .28, dark), rightLeg = leftLeg.clone(); leftLeg.position.set(-.18, .28, 0); rightLeg.position.set(.18, .28, 0); group.add(leftLeg, rightLeg);
  const tag = createNameTag(player.clan ? `[${player.clan}] ${player.name}` : player.name, player.clan ? '#f1bf59' : '#ffffff'); tag.position.y = 2.55; group.add(tag);
  group.userData = { entityType: 'player', id: player.id, name: player.name, clan: player.clan, target: new THREE.Vector3(player.x, player.y - EYE_HEIGHT, player.z), leftArm, rightArm, leftLeg, rightLeg };
  group.position.copy(group.userData.target); group.rotation.y = player.yaw || 0; return group;
}

function createMobModel(mob) {
  const group = new THREE.Group();
  let body;
  if (mob.kind === 'slime') {
    const mat = simpleMaterial(0x52b66b, 0x0d2612); body = box(1.15, .9, 1.15, mat); body.position.y = .5; group.add(body);
    const eye = simpleMaterial(0x15231c); for (const x of [-.25,.25]) { const e=box(.12,.16,.06,eye);e.position.set(x,.65,.59);group.add(e); }
  } else if (mob.kind === 'boar') {
    body = box(1.35,.75,.68,simpleMaterial(0x76503b));body.position.y=.65;group.add(body);const head=box(.64,.58,.58,simpleMaterial(0x8e6246));head.position.set(0,.65,.58);group.add(head);
    for(const x of [-.42,.42])for(const z of [-.22,.28]){const leg=box(.18,.55,.18,simpleMaterial(0x4f382c));leg.position.set(x,.26,z);group.add(leg)}
  } else if (mob.kind === 'golem') {
    const stone=simpleMaterial(0x676f68);body=box(1.05,1.2,.6,stone);body.position.y=1.05;group.add(body);const head=box(.7,.65,.65,simpleMaterial(0x7e887d));head.position.y=1.95;group.add(head);
    for(const x of [-.73,.73]){const arm=box(.35,1.25,.4,stone);arm.position.set(x,1.02,0);group.add(arm)}
  } else {
    const cloak = simpleMaterial(0x4d3a70, 0x1e0d35); body = box(.85,1.45,.45,cloak); body.position.y=1.05;group.add(body);const head=box(.58,.58,.58,simpleMaterial(0x9281bd,0x2b1748));head.position.y=1.92;group.add(head);
  }
  const hpBack=box(1.3,.09,.04,simpleMaterial(0x2b3130));hpBack.position.set(0,2.65,0);const hp=box(1.26,.065,.05,simpleMaterial(0xd85955));hp.position.set(0,2.65,.03);group.add(hpBack,hp);
  const tag=createNameTag(MOB_LABELS[mob.kind]||mob.kind,'#ffd4c7');tag.position.y=2.95;tag.scale.multiplyScalar(.78);group.add(tag);
  group.userData={entityType:'mob',id:mob.id,kind:mob.kind,target:new THREE.Vector3(mob.x,mob.y-.55,mob.z),hpBar:hp,maxHp:mob.maxHp};
  group.traverse(child=>child.userData.entityRoot=group);group.position.copy(group.userData.target);return group;
}

function createDragonModel(dragon) {
  const group = new THREE.Group(); const scale=1.25;
  const bodyMat=simpleMaterial(dragon.id.endsWith('1')?0x2c8b78:0x994735);const belly=simpleMaterial(0xd5ac62);const horn=simpleMaterial(0xe6d4a4);
  const body=box(1.2,.85,2.5,bodyMat);body.position.y=.9;group.add(body);const neck=box(.65,.72,1.25,bodyMat);neck.position.set(0,1.25,-1.55);neck.rotation.x=-.25;group.add(neck);
  const head=box(.9,.7,1,bodyMat);head.position.set(0,1.55,-2.2);group.add(head);const snout=box(.68,.38,.68,belly);snout.position.set(0,1.4,-2.82);group.add(snout);
  for(const x of [-.28,.28]){const h=box(.12,.42,.12,horn);h.position.set(x,2,-2.05);h.rotation.x=-.35;group.add(h)}
  const wingMaterial=new THREE.MeshLambertMaterial({color:dragon.id.endsWith('1')?0x45b39b:0xbb5d47,side:THREE.DoubleSide,transparent:true,opacity:.92});
  const wingGeo=new THREE.BufferGeometry();wingGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,3,.15,.8,2.5,0,2.2,0,0,1.2],3));wingGeo.setIndex([0,1,2,0,2,3]);wingGeo.computeVertexNormals();
  const leftWing=new THREE.Mesh(wingGeo,wingMaterial),rightWing=leftWing.clone();leftWing.position.set(.45,1.25,-.4);rightWing.position.set(-.45,1.25,-.4);rightWing.scale.x=-1;group.add(leftWing,rightWing);
  for(const x of [-.42,.42])for(const z of [-.75,.75]){const leg=box(.26,.72,.28,bodyMat);leg.position.set(x,.35,z);group.add(leg)}
  const tail=box(.48,.45,2.3,bodyMat);tail.position.set(0,.85,2.2);tail.rotation.x=-.12;group.add(tail);
  const tag=createNameTag(`${dragon.name} · Drago`,'#ffe092');tag.position.y=3.05;group.add(tag);
  group.scale.setScalar(scale);group.userData={entityType:'dragon',id:dragon.id,target:new THREE.Vector3(dragon.x,dragon.y-.8,dragon.z),leftWing,rightWing,rider:dragon.rider};group.traverse(child=>child.userData.entityRoot=group);group.position.copy(group.userData.target);group.rotation.y=dragon.yaw||0;return group;
}

function createLootBoxModel(boxData){
  const group=new THREE.Group(),wood=simpleMaterial(0x8d6034),trim=simpleMaterial(0xe0ad4f,0x2b1805);
  const chest=box(.92,.62,.72,wood);chest.position.y=.36;const lid=box(.96,.22,.76,trim);lid.position.y=.76;const lock=box(.15,.22,.05,trim);lock.position.set(0,.52,.39);group.add(chest,lid,lock);
  const tag=createNameTag(`Box di ${boxData.owner}`,'#ffe09a');tag.position.y=1.45;tag.scale.multiplyScalar(.78);group.add(tag);
  group.userData={entityType:'lootBox',id:boxData.id,owner:boxData.owner,target:new THREE.Vector3(boxData.x,boxData.y,boxData.z)};group.traverse(child=>child.userData.entityRoot=group);group.position.copy(group.userData.target);return group;
}

function createItemDropModel(drop){
  const group=new THREE.Group(),info=ITEM_INFO[drop.item]||[drop.item,'#777','?'];
  const item=box(.34,.34,.34,simpleMaterial(info[1]||0xb9b9b9,drop.item==='crystal'?0x164754:0));item.rotation.set(.25,.3,.12);group.add(item);
  const tag=createNameTag(`${itemName(drop.item)} ×${drop.amount||1}`,'#dff8e8');tag.position.y=.85;tag.scale.multiplyScalar(.62);group.add(tag);
  group.userData={entityType:'itemDrop',id:drop.id,item:drop.item,target:new THREE.Vector3(drop.x,drop.y,drop.z)};group.traverse(child=>child.userData.entityRoot=group);group.position.copy(group.userData.target);return group;
}

function syncPlayers(list) {
  const ids = new Set(list.map(player => player.id));
  for (const [id, model] of remotePlayers) if (!ids.has(id) || id === self?.id) { entityGroup.remove(model); remotePlayers.delete(id); }
  for (const player of list) {
    if (player.id === self?.id) continue;
    if (!remotePlayers.has(player.id)) { const model=createPlayerModel(player);remotePlayers.set(player.id,model);entityGroup.add(model); }
    const model=remotePlayers.get(player.id);model.userData.target.set(player.x,player.y-EYE_HEIGHT,player.z);model.userData.targetYaw=player.yaw||0;
  }
  $('#online-count').textContent=`${Math.max(1,list.length)} ${list.length===1?'esploratore':'esploratori'} online`;
}

function syncMobs(list) {
  const ids=new Set(list.map(m=>m.id));for(const[id,model]of mobs)if(!ids.has(id)){entityGroup.remove(model);mobs.delete(id)}
  for(const mob of list){if(!mobs.has(mob.id)){const model=createMobModel(mob);mobs.set(mob.id,model);entityGroup.add(model)}const model=mobs.get(mob.id);model.userData.target.set(mob.x,mob.y-.55,mob.z);model.userData.targetYaw=mob.yaw;model.userData.hpBar.scale.x=Math.max(.001,mob.hp/mob.maxHp);model.userData.hpBar.position.x=-.63*(1-mob.hp/mob.maxHp)}
}
function syncDragons(list) {
  const ids=new Set(list.map(d=>d.id));for(const[id,model]of dragons)if(!ids.has(id)){dragonGroup.remove(model);dragons.delete(id)}
  for(const dragon of list){if(!dragons.has(dragon.id)){const model=createDragonModel(dragon);dragons.set(dragon.id,model);dragonGroup.add(model)}const model=dragons.get(dragon.id);model.userData.target.set(dragon.x,dragon.y-.8,dragon.z);model.userData.targetYaw=dragon.yaw;model.userData.rider=dragon.rider}
}

function syncLootBoxes(list){
  const ids=new Set(list.map(item=>item.id));for(const[id,model]of lootBoxes)if(!ids.has(id)){entityGroup.remove(model);lootBoxes.delete(id)}
  for(const item of list){if(!lootBoxes.has(item.id)){const model=createLootBoxModel(item);lootBoxes.set(item.id,model);entityGroup.add(model)}const model=lootBoxes.get(item.id);model.userData.target.set(item.x,item.y,item.z)}
}
function syncItemDrops(list){
  const ids=new Set(list.map(item=>item.id));for(const[id,model]of itemDrops)if(!ids.has(id)){entityGroup.remove(model);itemDrops.delete(id)}
  for(const item of list){if(!itemDrops.has(item.id)){const model=createItemDropModel(item);itemDrops.set(item.id,model);entityGroup.add(model)}const model=itemDrops.get(item.id);model.userData.target.set(item.x,item.y,item.z)}
}

function iconMarkup(item) {
  const info=ITEM_INFO[item]||[item,'#666','?'];const tool=!info[1];return `<span class="item-icon ${tool?'tool':''}" style="--item:${info[1]||'transparent'}">${info[2]||''}</span>`;
}
function itemName(item){return ITEM_INFO[item]?.[0]||item}
function selectedItem(){return hotbarItems[selectedSlot]}

function refreshProfile(next) {
  profile={...profile,...next};
  $('#coins').textContent=profile.coins;$('#health-text').textContent=profile.health;$('#health-bar').style.width=`${profile.health}%`;
  $('#player-label').textContent=profile.name;$('#avatar-letter').textContent=profile.name[0].toUpperCase();$('#clan-label').textContent=profile.clan||'Senza clan';
  profile.health<=30?$('#health-bar').style.filter='brightness(1.35)':$('#health-bar').style.filter='';
  fillHotbar();updateHeldViewModel();renderInventory();renderQuests();renderCrafting();renderShop();renderClans();
  if(next.message)toast(next.message);
}

function fillHotbar() {
  const available=Object.keys(profile?.inventory||{}).filter(item=>(profile.inventory[item]||0)>0);
  hotbarItems=hotbarItems.map(item=>item&&profile.inventory[item]>0?item:null);
  for(const item of available){if(!hotbarItems.includes(item)&&hotbarItems.includes(null))hotbarItems[hotbarItems.indexOf(null)]=item}
  $('#hotbar').innerHTML=hotbarItems.map((item,index)=>`<button class="hot-slot ${index===selectedSlot?'selected':''}" data-slot="${index}" title="${item?itemName(item):'Vuoto'}"><span class="key">${index+1}</span>${item?iconMarkup(item):''}<span class="count">${item?(profile.inventory[item]||0):''}</span></button>`).join('');
  $$('.hot-slot').forEach(button=>button.onclick=()=>selectSlot(Number(button.dataset.slot)));
}
function selectSlot(index){selectedSlot=Math.max(0,Math.min(8,index));fillHotbar();updateHeldViewModel();sound('ui')}
function cycleHotbar(direction){
  for(let offset=1;offset<=hotbarItems.length;offset++){
    const index=(selectedSlot+direction*offset+hotbarItems.length)%hotbarItems.length;
    if(hotbarItems[index]){selectSlot(index);return}
  }
}
function equipItem(item){if(!hotbarItems.includes(item))hotbarItems[selectedSlot]=item;else selectedSlot=hotbarItems.indexOf(item);fillHotbar();updateHeldViewModel();toast(`${itemName(item)} equipaggiato`);sound('ui')}
function dropPosition(){camera.getWorldDirection(forward);forward.y=0;forward.normalize();return{x:camera.position.x+forward.x*1.7,y:camera.position.y-EYE_HEIGHT+.42,z:camera.position.z+forward.z*1.7}}
function showInventoryActions(item){
  const nearby=[...remotePlayers.values()].filter(model=>model.position.distanceTo(camera.position)<7).map(model=>({id:model.userData.id,name:model.userData.name}));const panel=$('#inventory-actions');
  panel.innerHTML=`<header>${iconMarkup(item)}<strong>${itemName(item)}</strong><button aria-label="Chiudi">×</button></header><div class="action-buttons"><button data-equip>Indossa / usa</button><button class="drop" data-drop>Getta a terra</button></div>${item!=='lootBox'?`<div class="gift-row"><select><option value="">Giocatore vicino…</option>${nearby.map(player=>`<option value="${player.id}">${escapeHtml(player.name)}</option>`).join('')}</select><button data-gift ${nearby.length?'':'disabled'}>Regala</button></div>`:'<p class="panel-copy">Posalo vicino al proprietario per restituirglielo.</p>'}`;
  panel.classList.remove('hidden');panel.querySelector('header button').onclick=()=>panel.classList.add('hidden');panel.querySelector('[data-equip]').onclick=()=>equipItem(item);
  panel.querySelector('[data-drop]').onclick=()=>{const position=dropPosition();if(item==='lootBox')socket.emit('dropLootBox',position);else socket.emit('dropItem',{item,...position});panel.classList.add('hidden')};
  const gift=panel.querySelector('[data-gift]');if(gift)gift.onclick=()=>{const targetId=panel.querySelector('select').value;if(targetId){socket.emit('giftItem',{item,targetId});panel.classList.add('hidden')}};
}
function renderInventory(){
  if(!profile)return;$('#inventory-grid').innerHTML=Object.entries(profile.inventory).sort((a,b)=>a[0].localeCompare(b[0])).map(([item,count])=>`<button class="inventory-item" data-item="${item}"><em>${count}</em>${iconMarkup(item)}<b>${itemName(item)}</b></button>`).join('')||'<p>Lo zaino è vuoto.</p>';
  $$('.inventory-item').forEach(button=>{button.onclick=()=>showInventoryActions(button.dataset.item);button.oncontextmenu=event=>{event.preventDefault();equipItem(button.dataset.item)}});
}
function costText(cost){return Object.entries(cost).map(([item,amount])=>`${amount} ${itemName(item)}`).join(' · ')}
function canAfford(cost){return Object.entries(cost).every(([item,amount])=>(profile?.inventory[item]||0)>=amount)}
function renderCrafting(){if(!profile)return;$('#recipe-list').innerHTML=Object.entries(recipes).map(([id,recipe])=>`<article class="shop-item"><strong>${recipe.label}</strong><p class="cost">${costText(recipe.cost)}</p><button data-craft="${id}" ${canAfford(recipe.cost)?'':'disabled'}>Crea</button></article>`).join('');$$('[data-craft]').forEach(button=>button.onclick=()=>socket.emit('craft',button.dataset.craft))}
function renderShop(){if(!profile)return;$('#shop-list').innerHTML=Object.entries(shop).map(([id,product])=>`<article class="shop-item"><strong>${product.label}</strong><p class="cost">◈ ${product.price} monete</p><button data-buy="${id}" ${profile.coins>=product.price?'':'disabled'}>Acquista</button></article>`).join('');$$('[data-buy]').forEach(button=>button.onclick=()=>socket.emit('buy',button.dataset.buy))}
function renderQuests(){if(!profile)return;const quests=profile.quests||[];$('#quests').innerHTML=quests.map(quest=>{const current=Math.min(profile.stats[quest.type]||0,quest.goal),done=profile.claimedQuests.includes(quest.id);return `<article class="quest ${done?'done':''}"><header><strong>${quest.title}</strong><b>${done?'COMPLETATA':`${current} / ${quest.goal}`}</b></header><p>${quest.description} · Ricompensa ◈ ${quest.reward}</p><div class="bar"><i style="width:${current/quest.goal*100}%"></i></div></article>`}).join('')}
function renderClans(){if(!profile)return;$('#clan-status').textContent=profile.clan?`Sei membro di ${profile.clan}. Il nome del clan appare sopra ogni compagno.`:'Crea una compagnia o unisciti a un clan esistente.';$('#clan-create').classList.toggle('hidden',Boolean(profile.clan));$('#leave-clan').classList.toggle('hidden',!profile.clan);$('#clan-list').innerHTML=clans.map(clan=>`<article class="clan-item"><strong>${clan.name}</strong><p>${clan.members.length}/12 membri · Leader ${clan.leader}</p>${!profile.clan?`<button data-join="${clan.name}">Unisciti</button>`:''}</article>`).join('')||'<p class="panel-copy">Non esistono ancora clan: puoi fondare il primo.</p>';$$('[data-join]').forEach(button=>button.onclick=()=>socket.emit('clanAction',{action:'join',name:button.dataset.join}))}

function openPanel(id){panelOpen=true;cancelMining();controls?.unlock();$('#panel-scrim').classList.remove('hidden');$$('.game-panel').forEach(panel=>panel.classList.toggle('open',panel.id===id));$('#pause-overlay').classList.add('hidden');sound('ui')}
function closePanels(){panelOpen=false;$('#panel-scrim').classList.add('hidden');$$('.game-panel').forEach(panel=>panel.classList.remove('open'));if(gameStarted&&!dead)controls.lock()}

function roundedBlock(value){return Math.floor(value+.5)}
function collidesAt(position) {
  const minX=roundedBlock(position.x-.31),maxX=roundedBlock(position.x+.31),minZ=roundedBlock(position.z-.31),maxZ=roundedBlock(position.z+.31);
  const minY=roundedBlock(position.y-EYE_HEIGHT+.05),maxY=roundedBlock(position.y+.08);
  for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(let z=minZ;z<=maxZ;z++)if(isSolid(getBlock(x,y,z)))return true;
  return false;
}
function playerOnGround(){return collidesAt(new THREE.Vector3(camera.position.x,camera.position.y-.09,camera.position.z))}

function updateMovement(dt) {
  if(!controls.isLocked||dead)return;
  if(mountedDragon){
    camera.getWorldDirection(forward);forward.normalize();right.crossVectors(forward,camera.up).normalize();
    moveDirection.set(0,0,0);if(keys.has('KeyW'))moveDirection.add(forward);if(keys.has('KeyS'))moveDirection.sub(forward);if(keys.has('KeyD'))moveDirection.add(right);if(keys.has('KeyA'))moveDirection.sub(right);if(keys.has('Space'))moveDirection.y+=1;if(keys.has('ShiftLeft')||keys.has('ShiftRight'))moveDirection.y-=1;
    if(moveDirection.lengthSq())camera.position.addScaledVector(moveDirection.normalize(),14*dt);camera.position.y=THREE.MathUtils.clamp(camera.position.y,3,48);return;
  }
  camera.getWorldDirection(forward);forward.y=0;forward.normalize();right.crossVectors(forward,camera.up).normalize();moveDirection.set(0,0,0);
  if(keys.has('KeyW'))moveDirection.add(forward);if(keys.has('KeyS'))moveDirection.sub(forward);if(keys.has('KeyD'))moveDirection.add(right);if(keys.has('KeyA'))moveDirection.sub(right);if(moveDirection.lengthSq())moveDirection.normalize();
  const running=keys.has('ShiftLeft')||keys.has('ShiftRight');const speed=running?7.2:4.8;velocity.x=moveDirection.x*speed;velocity.z=moveDirection.z*speed;velocity.y-=22*dt;
  if(keys.has('Space')&&playerOnGround()){velocity.y=8.1;keys.delete('Space')}
  const next=camera.position.clone();next.x+=velocity.x*dt;if(!collidesAt(next))camera.position.x=next.x;
  next.copy(camera.position);next.z+=velocity.z*dt;if(!collidesAt(next))camera.position.z=next.z;
  next.copy(camera.position);next.y+=velocity.y*dt;if(!collidesAt(next))camera.position.y=next.y;else{if(velocity.y<0){while(!collidesAt(new THREE.Vector3(camera.position.x,camera.position.y-.02,camera.position.z)))camera.position.y-=.02}velocity.y=0}
  if(camera.position.y<0){camera.position.set(spawn.x,spawn.y,spawn.z);velocity.set(0,0,0)}
}

function findEntityRoot(object){let current=object;while(current){if(current.userData?.entityRoot)return current.userData.entityRoot;if(current.userData?.entityType)return current;current=current.parent}return null}
function updateTarget() {
  if(!worldReady||!controls.isLocked)return;
  raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
  const blockHits=raycaster.intersectObjects(blockMeshes,false);const entityHits=raycaster.intersectObjects([...mobs.values(),...dragons.values(),...lootBoxes.values(),...itemDrops.values()],true);
  const blockHit=blockHits[0];const entityHit=entityHits.find(hit=>findEntityRoot(hit.object));
  if(entityHit&&(!blockHit||entityHit.distance<blockHit.distance)){
    const root=findEntityRoot(entityHit.object);currentTarget={kind:root.userData.entityType,id:root.userData.id,distance:entityHit.distance,owner:root.userData.owner,item:root.userData.item};selectionBox.visible=false;
    $('#target-label').textContent=root.userData.entityType==='mob'?MOB_LABELS[root.userData.kind]:root.userData.entityType==='dragon'?'Drago cavalcabile':root.userData.entityType==='lootBox'?`Box di ${root.userData.owner}`:itemName(root.userData.item);return;
  }
  if(blockHit&&blockHit.instanceId!==undefined){const position=blockHit.object.userData.positions[blockHit.instanceId];currentTarget={kind:'block',position,type:blockHit.object.userData.blockType,normal:blockHit.face.normal.clone(),distance:blockHit.distance};selectionBox.position.set(position.x,position.y,position.z);selectionBox.visible=true;$('#target-label').textContent=itemName(currentTarget.type);return}
  currentTarget=null;selectionBox.visible=false;$('#target-label').textContent='';
}

function onMouseAction(event) {
  if(!controls?.isLocked||dead)return;
  const now=performance.now();if(now-lastAction<170)return;lastAction=now;
  if(event.button===0&&currentTarget){
    if(currentTarget.kind==='mob'){socket.emit('attack',{id:currentTarget.id,held:selectedItem()});swingEffect();sound('attack')}
    else if(currentTarget.kind==='block')startMining(currentTarget)
  } else if(event.button===2&&currentTarget?.kind==='block'){
    const type=selectedItem();
    const p=currentTarget.position,n=currentTarget.normal;const position={x:p.x+Math.round(n.x),y:p.y+Math.round(n.y),z:p.z+Math.round(n.z)};
    if(type==='lootBox'){socket.emit('dropLootBox',position);return}
    if(!PLACEABLE.has(type)){toast('Seleziona un materiale da costruzione.','danger');return}
    if(Math.hypot(position.x-camera.position.x,position.z-camera.position.z)<.8&&Math.abs(position.y-(camera.position.y-EYE_HEIGHT))<1.8)return;
    socket.emit('place',{...position,type});
  }
}

function miningDuration(type) {
  const held=selectedItem();const hard=['stone','coal','iron','gold','crystal','obsidian','redstone','piston'].includes(type);
  let duration=hard?900:420;if(held==='woodPickaxe')duration*=.78;if(held==='stonePickaxe')duration*=.58;if(held==='ironPickaxe')duration*=.38;return Math.max(220,duration);
}
function startMining(target){
  const key=keyOf(target.position.x,target.position.y,target.position.z);if(miningAction?.key===key)return;
  cancelMining();miningAction={key,position:{...target.position},type:target.type,started:performance.now(),duration:miningDuration(target.type)};
  crackBox.position.set(target.position.x,target.position.y,target.position.z);crackBox.visible=true;$('#mining-progress').classList.remove('hidden');swingEffect();sound('mine');
}
function cancelMining(){miningAction=null;if(crackBox){crackBox.visible=false;crackBox.material.opacity=0}$('#mining-progress')?.classList.add('hidden')}
function updateMining(now){
  if(!miningAction)return;const progress=Math.min(1,(now-miningAction.started)/miningAction.duration);crackBox.material.opacity=.18+progress*.58;crackBox.rotation.set(progress*.7,progress*.9,0);$('#mining-progress i').style.width=`${progress*100}%`;viewModelSwing=Math.max(viewModelSwing,Math.sin(progress*Math.PI*3)*.75);
  if(progress>=1){const action=miningAction;cancelMining();socket.emit('mine',{...action.position,block:action.type});burst(action.position,ITEM_INFO[action.type]?.[1]||'#888');sound('break')}
}
function swingEffect(){viewModelSwing=1}
function updateViewModel(dt,elapsed){
  if(!viewModel)return;viewModelSwing=Math.max(0,viewModelSwing-dt*4.8);const moving=keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD');const bob=settings.bob&&moving?Math.sin(elapsed*10)*.025:0;const swing=Math.sin(viewModelSwing*Math.PI);
  viewModel.position.set(.56+bob*.5,-.48+Math.abs(bob),-.82);viewModel.rotation.set(-.18-swing*1.05,-.28,-.08+swing*.32);
}
const particles=[];
function burst(position,color){for(let i=0;i<7;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.09),new THREE.MeshBasicMaterial({color}));mesh.position.set(position.x+(Math.random()-.5),position.y+(Math.random()-.5),position.z+(Math.random()-.5));mesh.userData.velocity=new THREE.Vector3((Math.random()-.5)*2,Math.random()*2,(Math.random()-.5)*2);mesh.userData.life=.7;scene.add(mesh);particles.push(mesh)}}

function animateEntities(dt,elapsed){
  for(const model of remotePlayers.values()){model.position.lerp(model.userData.target,Math.min(1,dt*12));model.rotation.y=THREE.MathUtils.lerp(model.rotation.y,model.userData.targetYaw||0,dt*8);const moving=model.position.distanceTo(model.userData.target)>.02;const swing=moving?Math.sin(elapsed*9)*.55:0;model.userData.leftArm.rotation.x=swing;model.userData.rightArm.rotation.x=-swing;model.userData.leftLeg.rotation.x=-swing;model.userData.rightLeg.rotation.x=swing}
  for(const model of mobs.values()){model.position.lerp(model.userData.target,Math.min(1,dt*9));model.rotation.y=THREE.MathUtils.lerp(model.rotation.y,model.userData.targetYaw||0,dt*7);model.position.y+=Math.sin(elapsed*5+model.position.x)*.002;if(model.userData.kind==='slime')model.scale.y=.92+Math.sin(elapsed*6+model.position.z)*.09}
  nearbyDragon=null;let nearDistance=5;
  for(const model of dragons.values()){model.position.lerp(model.userData.target,Math.min(1,dt*8));model.rotation.y=THREE.MathUtils.lerp(model.rotation.y,model.userData.targetYaw||0,dt*6);const wing=Math.sin(elapsed*6)*.45;model.userData.leftWing.rotation.z=wing;model.userData.rightWing.rotation.z=-wing;const d=model.position.distanceTo(camera.position);if(d<nearDistance){nearDistance=d;nearbyDragon=model.userData.id}}
  for(const model of lootBoxes.values()){model.position.lerp(model.userData.target,Math.min(1,dt*10));model.rotation.y=Math.sin(elapsed*.8)*.08}
  for(const model of itemDrops.values()){model.position.lerp(model.userData.target,Math.min(1,dt*10));model.rotation.y+=dt*1.5;model.position.y=model.userData.target.y+Math.sin(elapsed*2.4+model.position.x)*.1}
  let interaction='';if(currentTarget?.kind==='lootBox')interaction=currentTarget.owner===profile?.name?'Recupera tutti i tuoi oggetti':`Raccogli il box di ${currentTarget.owner}`;else if(currentTarget?.kind==='itemDrop')interaction=`Raccogli ${itemName(currentTarget.item)}`;else if(currentTarget?.kind==='block'&&currentTarget.type==='lever')interaction='Aziona la leva';else if(mountedDragon)interaction='Scendi dal drago';else if(nearbyDragon)interaction='Cavalca il drago';
  $('#interaction-hint').classList.toggle('hidden',!interaction);if(interaction)$('#interaction-hint span').textContent=interaction;
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;p.userData.velocity.y-=4*dt;p.position.addScaledVector(p.userData.velocity,dt);p.scale.setScalar(Math.max(0,p.userData.life));if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();p.material.dispose();particles.splice(i,1)}}
}

function updateSky() {
  const angle=worldDay*Math.PI*2;const elevation=Math.sin(angle);const daylight=THREE.MathUtils.clamp(elevation*.8+.35,.08,1);
  sun.position.set(Math.cos(angle)*55,Math.max(-10,elevation*55),Math.sin(angle)*35);sun.intensity=daylight*2.6;hemiLight.intensity=.2+daylight*1.35;
  const night=new THREE.Color(0x07101f),day=new THREE.Color(0x87bfd3),sunset=new THREE.Color(0xc8795c);const sky=night.clone().lerp(day,daylight);if(daylight>.15&&daylight<.55)sky.lerp(sunset,.28);scene.background.copy(sky);scene.fog.color.copy(sky);stars.material.opacity=1-daylight;
  const skyCenter=camera.position;skyDome.position.copy(skyCenter);stars.position.copy(skyCenter);skyDome.material.uniforms.nightMix.value=1-daylight;
  const solarDirection=new THREE.Vector3(Math.cos(angle),elevation,Math.sin(angle)*.65).normalize();sunDisc.position.copy(skyCenter).addScaledVector(solarDirection,125);moonDisc.position.copy(skyCenter).addScaledVector(solarDirection,-125);sunDisc.visible=elevation>-.18;moonDisc.visible=elevation<.25;
  const isNight=daylight<.28;$('#day-icon').textContent=isNight?'☾':'☀';$('#day-label').textContent=isNight?'NOTTE':worldDay<.5?'GIORNO':'TRAMONTO';
}

function emitMovement(now) {
  if(!self||now-lastMoveSent<80)return;lastMoveSent=now;const euler=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');socket.emit('move',{x:camera.position.x,y:camera.position.y,z:camera.position.z,yaw:euler.y,pitch:euler.x});
}
function animate(now=0) {
  requestAnimationFrame(animate);if(!scene)return;const dt=Math.min(clock.getDelta(),.05),elapsed=clock.elapsedTime;updateMovement(dt);updateTarget();updateMining(now);updateViewModel(dt,elapsed);animateEntities(dt,elapsed);updateSky();
  const currentChunkX=Math.floor(camera.position.x/CHUNK_SIZE),currentChunkZ=Math.floor(camera.position.z/CHUNK_SIZE);if(worldReady&&(currentChunkX!==renderedChunkX||currentChunkZ!==renderedChunkZ))scheduleWorldRebuild();
  if(blockMaterials?.water?.uniforms)blockMaterials.water.uniforms.uTime.value=elapsed;
  for(const cloud of clouds){cloud.position.x+=cloud.userData.speed*dt;if(cloud.position.x-camera.position.x>75)cloud.position.x-=150}
  emitMovement(now);renderer.render(scene,camera);
}

function onResize(){if(!camera)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
function toast(text,type='info'){const element=document.createElement('div');element.className=`toast ${type}`;element.textContent=text;$('#toasts').appendChild(element);setTimeout(()=>element.remove(),4200)}
function chatLine(data,system=false){const line=document.createElement('div');line.className=`chat-line ${system?'system':''}`;line.innerHTML=system?escapeHtml(data):`<b>${data.clan?`[${escapeHtml(data.clan)}] `:''}${escapeHtml(data.name)}</b>${escapeHtml(data.text)}`;$('#chat-log').appendChild(line);while($('#chat-log').children.length>6)$('#chat-log').firstChild.remove();setTimeout(()=>line.style.opacity=.25,9000)}
function escapeHtml(text){const div=document.createElement('div');div.textContent=String(text);return div.innerHTML}

function startGame(data) {
  self=data.self;spawn=data.spawn;worldDay=data.worldDay;overrides=data.blocks||{};circuitPower=data.circuitPower||{};profile={...data.profile,quests:data.profile.quests||[]};recipes=data.recipes;shop=data.shop;clans=data.clans||[];
  $('#loading-screen').classList.add('active');$('#login-screen').classList.remove('active');$('#loading-copy').textContent='Sto preparando foreste, miniere e creature…';
  initThree();setTimeout(()=>{buildWorld();syncPlayers(data.players);syncMobs(data.monsters);syncDragons(data.dragons);syncLootBoxes(data.lootBoxes||[]);syncItemDrops(data.itemDrops||[]);refreshProfile(profile);$('#loading-progress').style.width='100%';setTimeout(()=>{$('#loading-screen').classList.remove('active');$('#hud').classList.remove('hidden');gameStarted=true;controls.lock();toast('Benvenuto a Terranovaland. La piazza è sicura.','quest');sound('quest')},350)},60);animate();
}

$('#login-form').addEventListener('submit',event=>{event.preventDefault();ensureAudio();sound('ui');const name=$('#player-name').value.trim();$('#login-error').textContent='';if(name.length<2){$('#login-error').textContent='Inserisci almeno 2 caratteri.';return}localStorage.setItem('terranovaland-name',name);socket.emit('login',{name})});
$('#player-name').value=localStorage.getItem('terranovaland-name')||'';
$('#chat-form').addEventListener('submit',event=>{event.preventDefault();const input=$('#chat-input');if(input.value.trim())socket.emit('chat',input.value);input.value='';$('#chat-form').classList.add('hidden');controls.lock()});
$('#clan-create').addEventListener('submit',event=>{event.preventDefault();const input=event.currentTarget.querySelector('input');if(input.value.trim())socket.emit('clanAction',{action:'create',name:input.value});input.value=''});
$('#leave-clan').onclick=()=>socket.emit('clanAction',{action:'leave'});
$$('[data-panel]').forEach(button=>button.onclick=()=>openPanel(button.dataset.panel));$$('.panel-close').forEach(button=>button.onclick=closePanels);$('#panel-scrim').onclick=closePanels;
$('#resume-button').onclick=()=>controls.lock();$('#settings-button').onclick=()=>openPanel('settings-panel');$('#help-button').onclick=()=>{controls.unlock();$('#help-overlay').classList.remove('hidden');$('#pause-overlay').classList.add('hidden')};$('.modal-x').onclick=()=>{$('#help-overlay').classList.add('hidden');controls.lock()};$('#respawn-button').onclick=()=>socket.emit('respawn');
$('#toggle-quests').onclick=()=>{const quests=$('#quests');quests.classList.toggle('hidden');$('#toggle-quests').textContent=quests.classList.contains('hidden')?'+':'−'};

for(const [selector,key,number] of [['#fov-setting','fov',true],['#sensitivity-setting','sensitivity',true],['#volume-setting','volume',true],['#quality-setting','quality',false],['#bob-setting','bob',false],['#ambient-setting','ambient',false]]){
  $(selector).addEventListener('input',event=>{settings[key]=event.target.type==='checkbox'?event.target.checked:number?Number(event.target.value):event.target.value;ensureAudio();applySettings();});
}
$('#reset-settings').onclick=()=>{settings={...DEFAULT_SETTINGS};applySettings();toast('Impostazioni consigliate ripristinate')};
applySettings(false);

function openChat(){if(!gameStarted||dead)return;cancelMining();controls.unlock();$('#pause-overlay').classList.add('hidden');$('#chat-form').classList.remove('hidden');$('#chat-input').focus()}

addEventListener('keydown',event=>{
  if((event.code==='KeyT'||event.code==='Enter')&&gameStarted&&!dead&&document.activeElement!==$('#chat-input')){event.preventDefault();openChat();return}
  if(['INPUT','SELECT'].includes(document.activeElement?.tagName))return;
  if(/^Digit[1-9]$/.test(event.code)){selectSlot(Number(event.code.slice(-1))-1);return}
  if(event.code==='Tab'){event.preventDefault();$('#inventory-panel').classList.contains('open')?closePanels():openPanel('inventory-panel')}
  else if(event.code==='KeyI')openPanel('inventory-panel');else if(event.code==='KeyC')openPanel('craft-panel');else if(event.code==='KeyM')openPanel('shop-panel');else if(event.code==='KeyL')openPanel('clan-panel');else if(event.code==='KeyO')openPanel('settings-panel');else if(event.code==='KeyF')socket.emit('consume','bread');
  else if(event.code==='KeyE'){
    if(currentTarget?.kind==='lootBox')socket.emit('interactLootBox',currentTarget.id);else if(currentTarget?.kind==='itemDrop')socket.emit('pickupItem',currentTarget.id);else if(currentTarget?.kind==='block'&&currentTarget.type==='lever')socket.emit('toggleCircuit',currentTarget.position);else if(mountedDragon||nearbyDragon)socket.emit('mountDragon',mountedDragon||nearbyDragon);
  }else keys.add(event.code);
});
addEventListener('keyup',event=>keys.delete(event.code));
addEventListener('blur',()=>keys.clear());
addEventListener('wheel',event=>{if(!gameStarted||panelOpen||dead)return;event.preventDefault();cycleHotbar(event.deltaY>0?1:-1)},{passive:false});

socket.on('welcome',startGame);
socket.on('loginError',message=>$('#login-error').textContent=message);
socket.on('connect_error',()=>$('#login-error').textContent='Server non raggiungibile. Riprovo automaticamente…');
socket.on('profile',next=>refreshProfile({...next,quests:next.quests||profile?.quests||[]}));
socket.on('toast',data=>{toast(data.text,data.type);if(data.type==='quest')sound('quest');else if(data.type==='coin')sound('coin')});
socket.on('blockChanged',data=>{overrides[keyOf(data.x,data.y,data.z)]=data.type;scheduleWorldRebuild();if(data.by===profile?.name&&data.type!==0)sound('place')});
socket.on('circuitState',next=>{circuitPower=next||{};scheduleWorldRebuild()});
socket.on('leverChanged',data=>{sound('ui');if(data.by===profile?.name)toast(data.active?'Circuito alimentato':'Circuito disattivato')});
socket.on('lootBoxes',syncLootBoxes);socket.on('itemDrops',syncItemDrops);
socket.on('playerJoined',player=>syncPlayers([...remotePlayers.values()].map(model=>({id:model.userData.id,x:model.position.x,y:model.position.y+EYE_HEIGHT,z:model.position.z,yaw:model.rotation.y,name:model.userData.name,clan:model.userData.clan})).concat(player,self)));
socket.on('playerMoved',player=>{const model=remotePlayers.get(player.id);if(model){model.userData.target.set(player.x,player.y-EYE_HEIGHT,player.z);model.userData.targetYaw=player.yaw}});
socket.on('playerLeft',id=>{const model=remotePlayers.get(id);if(model){entityGroup.remove(model);remotePlayers.delete(id)}$('#online-count').textContent=`${remotePlayers.size+1} esploratori online`});
socket.on('playerClan',data=>{if(data.id===self?.id)self.clan=data.clan});
socket.on('worldTick',data=>{worldDay=data.day;syncMobs(data.monsters);syncDragons(data.dragons)});
socket.on('monsterHit',data=>{const model=mobs.get(data.id);if(model){model.userData.hpBar.scale.x=Math.max(.001,data.hp/model.userData.maxHp);model.position.x+=(Math.random()-.5)*.25}});
socket.on('monsterDefeated',data=>{const model=mobs.get(data.id);if(model){burst(model.position,'#e6a34d');entityGroup.remove(model);mobs.delete(data.id)}if(data.by===profile?.name)sound('coin')});
socket.on('monsterSpawned',mob=>syncMobs([...mobs.values()].map(model=>({id:model.userData.id,kind:model.userData.kind,x:model.position.x,y:model.position.y+.55,z:model.position.z,hp:model.userData.maxHp,maxHp:model.userData.maxHp,yaw:model.rotation.y})).concat(mob)));
socket.on('dragons',syncDragons);
socket.on('dragonMounted',data=>{mountedDragon=data.id;sound('dragon');if(data.id)toast(`${data.name} ti ha accettato. Ora puoi volare!`,'quest');else toast('Sei sceso dal drago.')});
socket.on('health',health=>{if(profile){profile.health=health;refreshProfile(profile)}});
socket.on('playerDamaged',data=>{sound('hurt');const flash=$('#damage-flash');flash.classList.add('active');setTimeout(()=>flash.classList.remove('active'),120);toast(`${MOB_LABELS[data.source]||'Una creatura'} ti ha colpito: −${data.amount}`,'danger')});
socket.on('playerDied',()=>{dead=true;cancelMining();sound('hurt');controls.unlock();$('#pause-overlay').classList.add('hidden');$('#death-overlay').classList.remove('hidden')});
socket.on('respawned',data=>{dead=false;camera.position.set(data.x,data.y,data.z);velocity.set(0,0,0);$('#death-overlay').classList.add('hidden');controls.lock()});
socket.on('clans',next=>{clans=next;renderClans()});
socket.on('chat',data=>chatLine(data));socket.on('systemMessage',text=>chatLine(text,true));
