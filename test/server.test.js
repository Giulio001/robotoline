'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameServer } = require('../server');

test('il server espone /health e serve la pagina del gioco', async t => {
  const game = createGameServer({ isTest: true });
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${game.server.address().port}`;
  t.after(() => new Promise(resolve => game.server.close(resolve)));

  const health = await fetch(`${address}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const page = await fetch(`${address}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Factory/);

  const script = await fetch(`${address}/game.js`);
  assert.equal(script.status, 200);
});
