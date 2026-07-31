'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WINNING_LINES, sanitizeName, normalizeRoomCode, evaluateBoard, createRoom } = require('../server');

test('riconosce tutte le otto combinazioni vincenti', () => {
  assert.equal(WINNING_LINES.length, 8);
  for (const line of WINNING_LINES) {
    const board = Array(9).fill(null);
    line.forEach(index => { board[index] = 'X'; });
    assert.deepEqual(evaluateBoard(board), { winner: 'X', line, draw: false });
  }
});

test('riconosce pareggio e partita ancora aperta', () => {
  assert.deepEqual(evaluateBoard(['X','O','X','X','O','O','O','X','X']), { winner: null, line: [], draw: true });
  assert.deepEqual(evaluateBoard(['X','O',null,null,'X',null,null,null,'O']), { winner: null, line: [], draw: false });
});

test('normalizza nome e codice stanza senza accettare markup', () => {
  assert.equal(sanitizeName('  <Giulio>   Max  '), 'Giulio Max');
  assert.equal(sanitizeName('abcdefghijklmnopqrstuv'), 'abcdefghijklmnopqr');
  assert.equal(normalizeRoomCode(' ab-c 23 '), 'ABC23');
});

test('una stanza nuova parte vuota e in attesa', () => {
  const room = createRoom('ABCDE', true);
  assert.equal(room.code, 'ABCDE');
  assert.equal(room.status, 'waiting');
  assert.deepEqual(room.board, Array(9).fill(null));
  assert.equal(room.turn, 'X');
});
