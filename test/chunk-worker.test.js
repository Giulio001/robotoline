'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWorker() {
  const messages = [];
  const context = vm.createContext({ console });
  context.self = { postMessage(message) { messages.push(message); } };
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'chunk-worker.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'chunk-worker.js' });
  return { context, messages };
}

function containsPosition(packed, x, y, z) {
  for (let index = 0; index < packed.length; index += 3) if (packed[index] === x && packed[index + 1] === y && packed[index + 2] === z) return true;
  return false;
}

test('i chunk vengono generati fuori dal thread grafico e accettano modifiche incrementali', () => {
  const { context, messages } = loadWorker();
  context.self.onmessage({ data: { type: 'init', overrides: {}, circuitPower: {} } });
  assert.equal(messages.shift().type, 'ready');

  context.self.onmessage({ data: { type: 'build', requestId: 1, chunkX: 0, chunkZ: 0 } });
  const initial = messages.shift();
  assert.equal(initial.type, 'chunk');
  assert.ok(Object.values(initial.positionsByType).some(positions => positions.length > 0));

  const surfaceY = context.terrainHeight(0, 0);
  assert.ok(containsPosition(initial.positionsByType.grass, 0, surfaceY, 0));
  context.self.onmessage({ data: { type: 'blockUpdate', key: `0,${surfaceY},0`, blockType: 0 } });
  context.self.onmessage({ data: { type: 'build', requestId: 2, chunkX: 0, chunkZ: 0 } });
  const updated = messages.shift();
  assert.equal(containsPosition(updated.positionsByType.grass || [], 0, surfaceY, 0), false);
});

test('il client precarica un quadrato ampio e conserva una fascia di chunk', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8');
  assert.match(source, /new Worker\('\/chunk-worker\.js'\)/);
  assert.match(source, /renderChunkRadius\(\)\{return settings\.quality==='low'\?2:3\}/);
  assert.match(source, /keepRadius=renderChunkRadius\(\)\+1/);
  assert.match(source, /sharedBlockGeometries/);
});
