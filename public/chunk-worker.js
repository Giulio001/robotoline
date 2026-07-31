'use strict';

const WORLD_LIMIT = 1_000_000;
const CHUNK_SIZE = 16;
const WATER_LEVEL = 6;
const BLOCK_TYPES = ['grass','dirt','stone','sand','wood','leaves','planks','brick','obsidian','crystal','coal','iron','gold','redstone','redstoneWire','redstoneWireOn','lever','leverOn','lamp','lampOn','piston','pistonOn','snow','torch','water'];
const POWERED_TYPES = new Set(['redstoneWire', 'lever', 'lamp', 'piston']);
const NEIGHBORS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const chunkFeatureCache = new Map();
const generatedChunkCache = new Map();
let overrides = {};
let circuitPower = {};
let activeFeatures = null;
let activeTrees = null;

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
function biomeAt(x,z){if(Math.hypot(x,z)<12)return'meadow';const temperature=Math.sin(x*.018)*.55+Math.cos(z*.014)*.45,moisture=Math.cos(x*.013+z*.019)*.6+Math.sin(z*.026)*.4,volcanic=fract(Math.sin(Math.floor(x/36)*91.7+Math.floor(z/36)*47.3)*43758.5453);if(volcanic>.91&&Math.hypot(x,z)>35)return'volcanic';if(temperature<-.45)return'frost';if(temperature>.48&&moisture<-.08)return'desert';if(moisture>.48&&temperature>-.15)return'swamp';if(moisture>.02)return'forest';return'meadow'}
function worldHash(x, y, z = 0) { return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123); }
function keyOf(x, y, z) { return `${x},${y},${z}`; }
function chunkKey(chunkX, chunkZ) { return `${chunkX},${chunkZ}`; }

function isTreeOrigin(x, z) {
  const h = terrainHeight(x, z);
  const biome=biomeAt(x,z),threshold=biome==='forest'?.935:biome==='swamp'?.95:biome==='meadow'?.975:1;
  return Math.hypot(x, z) > 7 && h > WATER_LEVEL && h < 12 && worldHash(x, z, 19) > threshold;
}

function chunkFeature(chunkX, chunkZ) {
  const cacheKey=`${chunkX},${chunkZ}`;if(chunkFeatureCache.has(cacheKey))return chunkFeatureCache.get(cacheKey);
  if (chunkX === 0 && chunkZ === 0) return null;
  let type = null;
  if (chunkX === 1 && chunkZ === 1) type = 'castle';
  else if (chunkX === -2 && chunkZ === -2) type = 'dungeon';
  else if (chunkX === 4 && chunkZ === 2) type = 'dungeon';
  else if (chunkX === -5 && chunkZ === -3) type = 'dungeon';
  else if ((chunkX === 6 && chunkZ === 4) || (chunkX === -7 && chunkZ === 5)) type = 'skyDungeon';
  else if (chunkX === -3 && chunkZ === 0) type = 'ruin';
  else if (chunkX === -4 && chunkZ === 2) type = 'shrine';
  else if (chunkX === 3 && chunkZ === -4) type = 'tower';
  else {
    const chance = worldHash(chunkX, chunkZ, 77);
    if (chance < .7){chunkFeatureCache.set(cacheKey,null);return null}
    type = chance > .91 ? 'tower' : chance > .81 ? 'ruin' : 'shrine';
  }
  const forcedCenter=chunkX===1&&chunkZ===1?{x:24,z:24}:chunkX===-2&&chunkZ===-2?{x:-24,z:-24}:chunkX===4&&chunkZ===2?{x:72,z:40}:chunkX===-5&&chunkZ===-3?{x:-72,z:-40}:chunkX===6&&chunkZ===4?{x:104,z:72}:chunkX===-7&&chunkZ===5?{x:-104,z:88}:null;
  const x = forcedCenter?.x ?? chunkX * 16 + 8 + Math.floor((worldHash(chunkX, 11, chunkZ) - .5) * 4);
  const z = forcedCenter?.z ?? chunkZ * 16 + 8 + Math.floor((worldHash(chunkZ, 29, chunkX) - .5) * 4);
  const feature={ type, x, z, base:type==='skyDungeon'?22:terrainHeight(x, z) };chunkFeatureCache.set(cacheKey,feature);return feature;
}

function structurePart(feature, x, y, z) {
  const dx=x-feature.x,dz=z-feature.z,ax=Math.abs(dx),az=Math.abs(dz),base=feature.base;
  if(feature.type==='castle'&&ax<=7&&az<=7&&y>=base&&y<=base+9){
    if(y===base)return{handled:true,type:'brick'};
    const gate=dz===-7&&ax<=1&&y<=base+3;if(gate)return{handled:true,type:null};
    const tower=ax>=5&&az>=5;if(tower&&(ax===7||ax===5||az===7||az===5)&&y<=base+8)return{handled:true,type:y===base+8?'gold':'brick'};
    const wall=(ax===7||az===7)&&y<=base+5;if(wall)return{handled:true,type:'brick'};
    if(y===base+6&&(ax===7||az===7)&&(Math.abs(dx+dz)%2===0))return{handled:true,type:'stone'};
    if(y===base+1&&((dx===0&&az<=4)||(dz===0&&ax<=4)))return{handled:true,type:'planks'};
    return{handled:true,type:null};
  }
  if(feature.type==='dungeon'&&ax<=6&&az<=6&&y>=base-5&&y<=base+4){
    if(y===base-5)return{handled:true,type:'obsidian'};
    if(y<base){if(ax===6||az===6)return{handled:true,type:'brick'};const depth=base-y;if(dx===2&&dz===2-depth)return{handled:true,type:'stone'};if(dx===0&&dz===0&&y===base-4)return{handled:true,type:'crystal'};return{handled:true,type:null}}
    if(y===base)return{handled:true,type:(ax===6||az===6)?'obsidian':null};
    const gate=dz===-6&&ax<=1&&y<=base+2;if(gate)return{handled:true,type:null};
    if((ax===6||az===6)&&y<=base+3)return{handled:true,type:(dx+dz+y)%3===0?'obsidian':'brick'};
    return{handled:true,type:null};
  }
  if(feature.type==='tower'&&ax<=3&&az<=3&&y>=base&&y<=base+8){
    if(y===base)return{handled:true,type:'stone'};if(dz===-3&&dx===0&&y<=base+2)return{handled:true,type:null};
    if((ax===3||az===3)&&y<=base+7)return{handled:true,type:y===base+7?'gold':'brick'};
    if(y===base+8&&(ax===3||az===3)&&(Math.abs(dx+dz)%2===0))return{handled:true,type:'stone'};return{handled:true,type:null};
  }
  if(feature.type==='ruin'&&ax<=5&&az<=5&&y>=base&&y<=base+4){
    if(y===base&&((ax<=1&&az<=1)||ax===5||az===5))return{handled:true,type:'stone'};
    if((ax===5||az===5)&&y<=base+1+Math.floor(worldHash(x,z,6)*3)&&!(dz===-5&&ax<2))return{handled:true,type:'brick'};
    if((dx===-3&&dz===-3||dx===3&&dz===3)&&y<=base+4)return{handled:true,type:'obsidian'};return{handled:true,type:null};
  }
  if(feature.type==='shrine'&&ax<=4&&az<=4&&y>=base&&y<=base+6){
    if(y===base&&ax<=3&&az<=3)return{handled:true,type:'snow'};if((ax===3&&az===3)&&y<=base+5)return{handled:true,type:'crystal'};
    if(dx===0&&dz===0&&y===base+1)return{handled:true,type:'gold'};return{handled:true,type:null};
  }
  if(feature.type==='skyDungeon'&&ax<=8&&az<=8&&y>=base-2&&y<=base+7){
    if(y===base-2){if(ax<=5&&az<=5)return{handled:true,type:'obsidian'};if((ax<=8&&az<=2)||(az<=8&&ax<=2))return{handled:true,type:'stone'};return{handled:true,type:null}}
    if(y===base-1&&ax<=6&&az<=6)return{handled:true,type:ax===6||az===6?'brick':null};
    const gate=dz===-6&&ax<=1&&y<=base+2;if(gate)return{handled:true,type:null};
    if((ax===6||az===6)&&y<=base+4)return{handled:true,type:(x+z+y)%4===0?'crystal':'brick'};
    if((ax===3&&az===3)&&y<=base+6)return{handled:true,type:y===base+6?'gold':'obsidian'};
    if(y===base+5&&(ax===6||az===6)&&(Math.abs(dx+dz)%2===0))return{handled:true,type:'lamp'};return{handled:true,type:null};
  }
  return{handled:false,type:null};
}

function structureBlock(x,y,z){
  if(activeFeatures){for(const feature of activeFeatures){const part=structurePart(feature,x,y,z);if(part.handled)return part}return{handled:false,type:null}}
  const chunkX=Math.floor(x/16),chunkZ=Math.floor(z/16);
  for(let cx=chunkX-1;cx<=chunkX+1;cx++)for(let cz=chunkZ-1;cz<=chunkZ+1;cz++){
    const feature=chunkFeature(cx,cz);if(!feature)continue;const part=structurePart(feature,x,y,z);if(part.handled)return part;
  }
  return{handled:false,type:null};
}

function generatedBlock(x, y, z) {
  if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT || y < 0 || y > 32) return null;
  const structure=structureBlock(x,y,z);if(structure.handled)return structure.type;
  const height = terrainHeight(x, z),biome=biomeAt(x,z);
  if (y <= height) {
    if (y === 0) return 'obsidian';
    if (y === height) return height <= WATER_LEVEL?'sand':biome==='frost'?'snow':biome==='desert'?'sand':biome==='volcanic'?'obsidian':'grass';
    if (height - y <= 2) return biome==='desert'||height<=WATER_LEVEL?'sand':biome==='volcanic'?'stone':'dirt';
    const ore = worldHash(x, y, z);if (y < 5 && ore > 0.972) return 'crystal';if (y < 7 && ore > 0.95) return 'gold';if (y < 9 && ore > 0.925) return 'iron';if (y < 10 && ore > 0.895) return 'redstone';if (ore > 0.88) return 'coal';return 'stone';
  }
  if (y <= WATER_LEVEL) return 'water';
  const nearbyTrees=activeTrees||null;
  if(nearbyTrees)for(const tree of nearbyTrees){const tx=tree.x,tz=tree.z;if(Math.abs(tx-x)>2||Math.abs(tz-z)>2)continue;const th=tree.height;
    if (x === tx && z === tz && y >= th + 1 && y <= th + 4) return 'wood';
    const dy = y - (th + 4),canopy = Math.abs(x - tx) + Math.abs(z - tz) + Math.abs(dy) * 1.25;
    if (dy >= -1 && dy <= 2 && canopy <= 3.7) return 'leaves';
  }else for (let tx = x - 2; tx <= x + 2; tx++) for (let tz = z - 2; tz <= z + 2; tz++) {
    if (!isTreeOrigin(tx, tz)) continue;const th = terrainHeight(tx, tz);
    if (x === tx && z === tz && y >= th + 1 && y <= th + 4) return 'wood';
    const dy = y - (th + 4),canopy = Math.abs(x - tx) + Math.abs(z - tz) + Math.abs(dy) * 1.25;
    if (dy >= -1 && dy <= 2 && canopy <= 3.7) return 'leaves';
  }
  return null;
}

function getBlock(x, y, z) {
  const override = overrides[keyOf(x, y, z)];
  if (override === 0) return null;
  if (override) return override;
  const cacheKey=chunkKey(Math.floor(x/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE));let cache=generatedChunkCache.get(cacheKey);
  if(!cache){cache=new Map();generatedChunkCache.set(cacheKey,cache)}
  const localKey=keyOf(x,y,z);if(cache.has(localKey))return cache.get(localKey);const generated=generatedBlock(x,y,z);cache.set(localKey,generated);return generated;
}

function buildChunk(chunkX, chunkZ) {
  const positionsByType = Object.fromEntries(BLOCK_TYPES.map(type => [type, []]));
  const startX=chunkX*CHUNK_SIZE,startZ=chunkZ*CHUNK_SIZE,endX=startX+CHUNK_SIZE-1,endZ=startZ+CHUNK_SIZE-1;
  activeFeatures=[];for(let cx=chunkX-2;cx<=chunkX+2;cx++)for(let cz=chunkZ-2;cz<=chunkZ+2;cz++){const feature=chunkFeature(cx,cz);if(feature)activeFeatures.push(feature)}
  activeTrees=[];for(let tx=startX-3;tx<=endX+3;tx++)for(let tz=startZ-3;tz<=endZ+3;tz++)if(isTreeOrigin(tx,tz))activeTrees.push({x:tx,z:tz,height:terrainHeight(tx,tz)});
  for(let x=startX;x<=endX;x++)for(let z=startZ;z<=endZ;z++)for(let y=0,top=Math.max(terrainHeight(x,z)+11,WATER_LEVEL+1,30);y<=top;y++){
    const type=getBlock(x,y,z);if(!type||!positionsByType[type])continue;
    const exposed=NEIGHBORS.some(([dx,dy,dz])=>{const neighbor=getBlock(x+dx,y+dy,z+dz);return!neighbor||(type!=='water'&&neighbor==='water')||(type==='water'&&neighbor!=='water')});
    const powered=circuitPower[keyOf(x,y,z)]&&POWERED_TYPES.has(type),renderType=powered?`${type}On`:type;
    if(exposed&&positionsByType[renderType])positionsByType[renderType].push(x,y,z);
  }
  const result={},transfer=[];
  for(const[type,positions]of Object.entries(positionsByType)){if(!positions.length)continue;const packed=new Int32Array(positions);result[type]=packed;transfer.push(packed.buffer)}
  activeFeatures=null;activeTrees=null;
  return { result, transfer };
}

self.onmessage = event => {
  const data = event.data || {};
  if(data.type==='init'){overrides=data.overrides||{};circuitPower=data.circuitPower||{};self.postMessage({type:'ready'});return}
  if(data.type==='blockUpdate'){overrides[data.key]=data.blockType;return}
  if(data.type==='circuitUpdate'){circuitPower=data.circuitPower||{};return}
  if(data.type==='prune'){
    for(const key of generatedChunkCache.keys()){const[x,z]=key.split(',').map(Number);if(Math.abs(x-data.centerX)>data.radius||Math.abs(z-data.centerZ)>data.radius)generatedChunkCache.delete(key)}
    return;
  }
  if(data.type==='build'){
    const {result,transfer}=buildChunk(data.chunkX,data.chunkZ);
    self.postMessage({type:'chunk',requestId:data.requestId,chunkX:data.chunkX,chunkZ:data.chunkZ,positionsByType:result},transfer);
  }
};
