'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { terrainHeight, SPAWN, RECIPES, SHOP } = require('../server');

test('lo spawn comune è sopra il terreno e deterministico', () => {
  assert.equal(SPAWN.x, 0);
  assert.equal(SPAWN.z, 0);
  assert.equal(SPAWN.y, terrainHeight(0, 0) + 2.2);
  assert.equal(terrainHeight(12, -7), terrainHeight(12, -7));
});

test('il terreno rimane entro limiti giocabili', () => {
  for (let x = -48; x <= 48; x += 4) {
    for (let z = -48; z <= 48; z += 4) assert.ok(terrainHeight(x, z) >= 3 && terrainHeight(x, z) <= 15);
  }
});

test('ricette e mercato hanno costi validi', () => {
  assert.ok(Object.keys(RECIPES).length >= 8);
  assert.ok(Object.values(RECIPES).every(recipe => Object.values(recipe.cost).every(amount => amount > 0)));
  assert.ok(Object.keys(SHOP).length >= 5);
  assert.ok(Object.values(SHOP).every(product => product.price > 0));
});
