'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { server, SPAWN } = require('../server');

test('un giocatore entra e riceve lo stato multiplayer completo', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const client = createClient(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], forceNew: true });

  const playerName = `Test${Date.now().toString().slice(-8)}`;
  const welcome = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout durante il login')), 2500);
    client.on('connect', () => client.emit('login', { name: playerName }));
    client.on('welcome', payload => { clearTimeout(timeout); resolve(payload); });
    client.on('connect_error', reject);
  });

  const payload = await welcome;
  assert.equal(payload.self.name, playerName);
  assert.deepEqual(payload.spawn, SPAWN);
  assert.ok(payload.monsters.length >= 20);
  assert.ok(payload.dragons.length >= 2);
  assert.ok(Object.keys(payload.recipes).length >= 12);
  assert.ok(Object.keys(payload.shop).length >= 5);

  const dropped = new Promise(resolve => client.once('itemDrops', resolve));
  client.emit('dropItem', { item: 'grass', x: SPAWN.x + 1, y: SPAWN.y - 1, z: SPAWN.z });
  const drops = await dropped;
  const groundItem = drops.find(item => item.droppedBy === playerName);
  assert.equal(groundItem.item, 'grass');

  const pickedUp = new Promise(resolve => client.once('itemDrops', resolve));
  client.emit('pickupItem', groundItem.id);
  const remaining = await pickedUp;
  assert.ok(!remaining.some(item => item.id === groundItem.id));
  client.close();
  await new Promise(resolve => server.close(resolve));
});
