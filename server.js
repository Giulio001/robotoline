'use strict';

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const WINNING_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
]);

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, maxLength);
}

function sanitizeName(value) {
  return cleanText(value, 18).replace(/\s+/g, ' ');
}

function normalizeRoomCode(value) {
  return cleanText(value, 24).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function evaluateBoard(board) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line, draw: false };
  }
  return { winner: null, line: [], draw: board.every(Boolean) };
}

function createRoomCode(rooms) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bytes = crypto.randomBytes(5);
    const code = [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
    if (!rooms.has(code)) return code;
  }
  throw new Error('Impossibile creare un codice stanza');
}

function createRoom(code, isPrivate = false) {
  return {
    code,
    isPrivate,
    players: [],
    board: Array(9).fill(null),
    turn: 'X',
    status: 'waiting',
    winner: null,
    winningLine: [],
    round: 1,
    rematchVotes: new Set(),
    lastMoveAt: 0
  };
}

function createGameServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: false },
    maxHttpBufferSize: 100_000,
    pingTimeout: 20_000,
    pingInterval: 25_000
  });
  const rooms = new Map();
  const users = new Map();
  const quickQueue = [];

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });
  app.get('/health', (_request, response) => response.json({ ok: true, players: users.size, rooms: rooms.size }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: options.isTest ? 0 : '1h' }));

  function onlineNames() {
    return new Set([...users.values()].map(user => user.name.toLocaleLowerCase('it-IT')));
  }

  function publicRoom(room, viewerId) {
    const ownPlayer = room.players.find(player => player.id === viewerId);
    return {
      code: room.code,
      board: room.board,
      turn: room.turn,
      status: room.status,
      winner: room.winner,
      winningLine: room.winningLine,
      round: room.round,
      rematchVotes: room.rematchVotes.size,
      ownSymbol: ownPlayer?.symbol || null,
      players: room.players.map(player => ({ name: player.name, symbol: player.symbol, score: player.score }))
    };
  }

  function emitRoom(room) {
    for (const player of room.players) io.to(player.id).emit('roomState', publicRoom(room, player.id));
  }

  function emitPresence() {
    io.emit('presence', { online: users.size, playing: [...rooms.values()].filter(room => room.status === 'playing').length * 2 });
  }

  function removeFromQueue(socketId) {
    let index = quickQueue.indexOf(socketId);
    while (index !== -1) {
      quickQueue.splice(index, 1);
      index = quickQueue.indexOf(socketId);
    }
  }

  function startRoom(room) {
    if (room.players.length !== 2) return;
    room.board = Array(9).fill(null);
    room.turn = 'X';
    room.status = 'playing';
    room.winner = null;
    room.winningLine = [];
    room.rematchVotes.clear();
    emitRoom(room);
    io.to(room.code).emit('gameMessage', { text: `Round ${room.round}: inizia X!`, tone: 'start' });
    emitPresence();
  }

  function addPlayerToRoom(socket, room, emitWaiting = true) {
    const user = users.get(socket.id);
    if (!user || room.players.length >= 2 || user.roomCode) return false;
    removeFromQueue(socket.id);
    const symbol = room.players.some(player => player.symbol === 'X') ? 'O' : 'X';
    room.players.push({ id: socket.id, name: user.name, symbol, score: 0 });
    user.roomCode = room.code;
    socket.join(room.code);
    if (room.players.length === 2) startRoom(room); else if (emitWaiting) emitRoom(room);
    return true;
  }

  function leaveRoom(socket, notify = true) {
    removeFromQueue(socket.id);
    const user = users.get(socket.id);
    if (!user?.roomCode) return;
    const room = rooms.get(user.roomCode);
    const oldCode = user.roomCode;
    user.roomCode = null;
    socket.leave(oldCode);
    if (!room) return;
    const leavingPlayer = room.players.find(player => player.id === socket.id);
    room.players = room.players.filter(player => player.id !== socket.id);
    room.rematchVotes.delete(socket.id);
    if (!room.players.length) {
      rooms.delete(room.code);
    } else {
      const survivor = room.players[0];
      survivor.symbol = 'X';
      room.board = Array(9).fill(null);
      room.turn = 'X';
      room.status = 'waiting';
      room.winner = null;
      room.winningLine = [];
      if (notify) io.to(survivor.id).emit('gameMessage', { text: `${leavingPlayer?.name || 'L’avversario'} ha lasciato la partita. In attesa di un nuovo giocatore…`, tone: 'leave' });
      emitRoom(room);
    }
    emitPresence();
  }

  function requireUser(socket) {
    const user = users.get(socket.id);
    if (!user) socket.emit('actionError', 'Prima inserisci il tuo nome.');
    return user;
  }

  io.on('connection', socket => {
    socket.emit('presence', { online: users.size, playing: [...rooms.values()].filter(room => room.status === 'playing').length * 2 });

    socket.on('login', rawName => {
      if (users.has(socket.id)) return;
      const name = sanitizeName(rawName);
      if (name.length < 2) return socket.emit('loginError', 'Inserisci un nome di almeno 2 caratteri.');
      if (onlineNames().has(name.toLocaleLowerCase('it-IT'))) return socket.emit('loginError', 'Questo nome è già online. Scegline un altro.');
      users.set(socket.id, { name, roomCode: null, lastActionAt: 0 });
      socket.emit('loggedIn', { name });
      emitPresence();
    });

    socket.on('quickMatch', () => {
      const user = requireUser(socket);
      if (!user || user.roomCode) return;
      removeFromQueue(socket.id);
      let opponentId = quickQueue.shift();
      while (opponentId && (!users.has(opponentId) || opponentId === socket.id || users.get(opponentId).roomCode)) opponentId = quickQueue.shift();
      if (!opponentId) {
        quickQueue.push(socket.id);
        socket.emit('queueState', { waiting: true });
        return;
      }
      const room = createRoom(createRoomCode(rooms), false);
      rooms.set(room.code, room);
      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (!opponentSocket || !addPlayerToRoom(opponentSocket, room, false) || !addPlayerToRoom(socket, room)) {
        rooms.delete(room.code);
        if (opponentSocket && users.get(opponentId) && !users.get(opponentId).roomCode) quickQueue.unshift(opponentId);
        quickQueue.push(socket.id);
        return socket.emit('queueState', { waiting: true });
      }
      io.to(room.code).emit('queueState', { waiting: false });
    });

    socket.on('cancelQueue', () => {
      removeFromQueue(socket.id);
      socket.emit('queueState', { waiting: false });
    });

    socket.on('createRoom', () => {
      const user = requireUser(socket);
      if (!user || user.roomCode) return;
      const room = createRoom(createRoomCode(rooms), true);
      rooms.set(room.code, room);
      addPlayerToRoom(socket, room);
    });

    socket.on('joinRoom', rawCode => {
      const user = requireUser(socket);
      if (!user || user.roomCode) return;
      const code = normalizeRoomCode(rawCode);
      const room = rooms.get(code);
      if (!room) return socket.emit('actionError', 'Stanza non trovata. Controlla il codice.');
      if (room.players.length >= 2) return socket.emit('actionError', 'Questa stanza è già completa.');
      addPlayerToRoom(socket, room);
    });

    socket.on('move', rawIndex => {
      const user = requireUser(socket);
      if (!user?.roomCode) return;
      const now = Date.now();
      if (now - user.lastActionAt < 80) return;
      user.lastActionAt = now;
      const room = rooms.get(user.roomCode);
      const player = room?.players.find(item => item.id === socket.id);
      const index = Number(rawIndex);
      if (!room || !player || room.status !== 'playing') return;
      if (player.symbol !== room.turn) return socket.emit('actionError', 'Aspetta il turno dell’avversario.');
      if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index]) return socket.emit('actionError', 'Questa casella non è disponibile.');
      room.board[index] = player.symbol;
      room.lastMoveAt = now;
      const result = evaluateBoard(room.board);
      if (result.winner) {
        room.status = 'won';
        room.winner = result.winner;
        room.winningLine = result.line;
        player.score += 1;
      } else if (result.draw) {
        room.status = 'draw';
      } else {
        room.turn = room.turn === 'X' ? 'O' : 'X';
      }
      emitRoom(room);
      if (room.status === 'won') io.to(room.code).emit('gameMessage', { text: `${player.name} ha fatto tris!`, tone: 'win' });
      else if (room.status === 'draw') io.to(room.code).emit('gameMessage', { text: 'Pareggio! Nessuna casella libera.', tone: 'draw' });
      emitPresence();
    });

    socket.on('rematch', () => {
      const user = requireUser(socket);
      const room = user?.roomCode ? rooms.get(user.roomCode) : null;
      if (!room || !['won', 'draw'].includes(room.status)) return;
      room.rematchVotes.add(socket.id);
      if (room.rematchVotes.size < 2) {
        emitRoom(room);
        return socket.emit('gameMessage', { text: 'Richiesta inviata. Aspettiamo l’avversario…', tone: 'wait' });
      }
      room.players.forEach(player => { player.symbol = player.symbol === 'X' ? 'O' : 'X'; });
      room.round += 1;
      startRoom(room);
    });

    socket.on('leaveRoom', () => leaveRoom(socket));

    socket.on('disconnect', () => {
      leaveRoom(socket);
      removeFromQueue(socket.id);
      users.delete(socket.id);
      emitPresence();
    });
  });

  return { app, server, io, rooms, users, quickQueue };
}

if (require.main === module) {
  const { server } = createGameServer();
  server.listen(PORT, HOST, () => console.log(`Tris Online è attivo su http://${HOST}:${PORT}`));
}

module.exports = { WINNING_LINES, sanitizeName, normalizeRoomCode, evaluateBoard, createRoom, createGameServer };
