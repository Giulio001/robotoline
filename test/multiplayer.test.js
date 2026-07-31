'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createGameServer } = require('../server');

function once(socket, event, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout evento ${event}`)), timeout);
    socket.once(event, data => { clearTimeout(timer); resolve(data); });
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function login(socket, name) {
  const ready = once(socket, 'loggedIn');
  socket.emit('login', name);
  return ready;
}

test('due giocatori entrano con un codice, fanno tris e chiedono la rivincita', async t => {
  const game = createGameServer({ isTest: true });
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${game.server.address().port}`;
  const first = connect(address, { transports: ['websocket'], forceNew: true });
  const second = connect(address, { transports: ['websocket'], forceNew: true });
  t.after(async () => {
    first.disconnect(); second.disconnect();
    await new Promise(resolve => game.io.close(resolve));
    await new Promise(resolve => game.server.close(resolve));
  });

  await Promise.all([once(first, 'connect'), once(second, 'connect')]);
  await Promise.all([login(first, 'Giulio'), login(second, 'Luca')]);

  const waitingState = once(first, 'roomState');
  first.emit('createRoom');
  const waiting = await waitingState;
  assert.equal(waiting.status, 'waiting');
  assert.match(waiting.code, /^[A-Z2-9]{5}$/);

  const firstStart = once(first, 'roomState');
  const secondStart = once(second, 'roomState');
  second.emit('joinRoom', waiting.code);
  const [startedForFirst, startedForSecond] = await Promise.all([firstStart, secondStart]);
  assert.equal(startedForFirst.status, 'playing');
  assert.equal(startedForFirst.ownSymbol, 'X');
  assert.equal(startedForSecond.ownSymbol, 'O');

  const sequence = [
    [first, 0], [second, 3], [first, 1], [second, 4], [first, 2]
  ];
  let state = startedForFirst;
  for (const [player, cell] of sequence) {
    await delay(85);
    const update = once(first, 'roomState');
    player.emit('move', cell);
    state = await update;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.winner, 'X');
  assert.deepEqual(state.winningLine, [0, 1, 2]);
  assert.equal(state.players.find(player => player.name === 'Giulio').score, 1);

  const firstVote = once(first, 'roomState');
  first.emit('rematch');
  assert.equal((await firstVote).rematchVotes, 1);
  const restarted = once(first, 'roomState');
  second.emit('rematch');
  const roundTwo = await restarted;
  assert.equal(roundTwo.round, 2);
  assert.equal(roundTwo.status, 'playing');
  assert.equal(roundTwo.ownSymbol, 'O');
  assert.deepEqual(roundTwo.board, Array(9).fill(null));
});

test('il matchmaking rapido abbina due utenti e blocca i nomi duplicati', async t => {
  const game = createGameServer({ isTest: true });
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${game.server.address().port}`;
  const first = connect(address, { transports: ['websocket'], forceNew: true });
  const second = connect(address, { transports: ['websocket'], forceNew: true });
  const duplicate = connect(address, { transports: ['websocket'], forceNew: true });
  t.after(async () => {
    first.disconnect(); second.disconnect(); duplicate.disconnect();
    await new Promise(resolve => game.io.close(resolve));
    await new Promise(resolve => game.server.close(resolve));
  });

  await Promise.all([once(first, 'connect'), once(second, 'connect'), once(duplicate, 'connect')]);
  await Promise.all([login(first, 'Anna'), login(second, 'Marco')]);
  const duplicateError = once(duplicate, 'loginError');
  duplicate.emit('login', 'ANNA');
  assert.match(await duplicateError, /già online/i);

  const queueState = once(first, 'queueState');
  first.emit('quickMatch');
  assert.deepEqual(await queueState, { waiting: true });
  const firstRoom = once(first, 'roomState');
  const secondRoom = once(second, 'roomState');
  second.emit('quickMatch');
  const [one, two] = await Promise.all([firstRoom, secondRoom]);
  assert.equal(one.code, two.code);
  assert.equal(one.players.length, 2);
  assert.equal(one.status, 'playing');
});
