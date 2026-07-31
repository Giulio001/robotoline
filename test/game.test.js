'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { terrainHeight, SPAWN, RECIPES, SHOP, QUESTS, LANDMARKS, freshProfile, activeQuest, advanceQuest, updateDragonFlight, createDeathBox } = require('../server');

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
  assert.ok(Object.keys(RECIPES).length >= 12);
  assert.ok(Object.values(RECIPES).every(recipe => Object.values(recipe.cost).every(amount => amount > 0)));
  assert.ok(Object.keys(SHOP).length >= 5);
  assert.ok(Object.values(SHOP).every(product => product.price > 0));
});

test('ogni nuovo esploratore riceve un piccone iniziale', () => {
  const profile = freshProfile('Giulio');
  assert.equal(profile.inventory.woodPickaxe, 1);
  assert.equal(profile.starterGranted, true);
});

test('la campagna contiene quindici missioni progressive con ricompense', () => {
  const profile = freshProfile('Avventuriero');
  assert.equal(QUESTS.length, 15);
  assert.equal(activeQuest(profile).id, 'wood_call');
  for (let index = 0; index < 4; index += 1) advanceQuest(null, profile, 'mine', 'wood');
  assert.equal(profile.questIndex, 1);
  assert.ok(profile.completedQuests.includes('wood_call'));
  assert.equal(profile.xp, 25);
  assert.equal(profile.inventory.planks, 4);
});

test('il mondo offre luoghi d’esplorazione distinti e persistenti', () => {
  const profile = freshProfile('Cartografo');
  assert.ok(LANDMARKS.length >= 8);
  assert.equal(new Set(LANDMARKS.map(landmark => landmark.id)).size, LANDMARKS.length);
  assert.deepEqual(profile.discoveredLandmarks, []);
  assert.ok(LANDMARKS.some(landmark => landmark.type === 'dungeon'));
  assert.ok(LANDMARKS.some(landmark => landmark.type === 'lago'));
});

test('i draghi senza cavaliere volano autonomamente', () => {
  const dragon = { x: 10, y: 8, z: 10, homeX: 10, homeZ: 10, phase: 0, speed: .2, flightRadius: 9, rider: null };
  updateDragonFlight(dragon, 1);
  assert.notEqual(dragon.x, 10);
  assert.ok(dragon.y > 8);
  assert.equal(typeof dragon.flying, 'boolean');
});

test('alla morte inventario e monete finiscono nel box persistente', () => {
  const profile = freshProfile('Caduto');
  const originalGrass = profile.inventory.grass;
  const originalCoins = profile.coins;
  const box = createDeathBox({ x: 4, y: 10, z: -2 }, profile);
  assert.equal(box.owner, 'Caduto');
  assert.equal(box.items.grass, originalGrass);
  assert.equal(box.coins, originalCoins);
  assert.deepEqual(profile.inventory, {});
  assert.equal(profile.coins, 0);
});
