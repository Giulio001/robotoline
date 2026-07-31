'use strict';

const socket = window.io({ transports: ['websocket', 'polling'] });
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let playerName = '';
let roomState = null;
let queued = false;
let soundEnabled = localStorage.getItem('tris-sound') !== 'off';
let audioContext = null;
let rematchRequested = false;
let reconnecting = false;

function showView(id) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === id));
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  $('#toasts').appendChild(element);
  setTimeout(() => element.remove(), 3600);
}

function ensureAudio() {
  if (!soundEnabled) return null;
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function tone(frequency, duration = .12, type = 'sine', volume = .045, delay = 0) {
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + duration);
}

function playSound(name) {
  if (name === 'moveX') tone(245, .1, 'triangle');
  if (name === 'moveO') tone(410, .12, 'sine');
  if (name === 'start') { tone(360, .1); tone(520, .13, 'sine', .04, .1); }
  if (name === 'win') [523, 659, 784, 1047].forEach((value, index) => tone(value, .22, 'sine', .045, index * .085));
  if (name === 'draw') { tone(310, .14); tone(270, .18, 'triangle', .04, .12); }
  if (name === 'error') tone(125, .15, 'sawtooth', .035);
  if (name === 'click') tone(480, .06, 'sine', .025);
}

function confetti() {
  const host = $('#confetti');
  const colors = ['#ff5d73', '#55d6be', '#8b7cf6', '#ffdb7a', '#f7f8fb'];
  for (let index = 0; index < 70; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty('--duration', `${2.2 + Math.random() * 1.8}s`);
    piece.style.setProperty('--drift', `${(Math.random() - .5) * 260}px`);
    piece.style.animationDelay = `${Math.random() * .4}s`;
    host.appendChild(piece);
    setTimeout(() => piece.remove(), 4400);
  }
}

function renderPlayer(symbol) {
  const element = $(`#player-${symbol.toLowerCase()}`);
  const player = roomState?.players.find(item => item.symbol === symbol);
  element.querySelector('strong').textContent = player?.name || 'In attesa…';
  element.querySelector('.score').textContent = player?.score ?? 0;
  element.classList.toggle('active', roomState?.status === 'playing' && roomState.turn === symbol);
}

function renderBoard() {
  if (!roomState) return;
  const playable = roomState.status === 'playing' && roomState.turn === roomState.ownSymbol;
  $$('#board [data-cell]').forEach((cell, index) => {
    const mark = roomState.board[index];
    cell.textContent = mark || '';
    cell.className = mark ? mark.toLowerCase() : '';
    cell.classList.toggle('winner', roomState.winningLine.includes(index));
    cell.disabled = !playable || Boolean(mark);
    cell.setAttribute('aria-label', mark ? `Casella ${index + 1}: ${mark}` : `Casella ${index + 1}: vuota`);
  });
}

function renderStatus() {
  const banner = $('#turn-banner');
  banner.className = 'turn-banner';
  if (roomState.status === 'waiting') {
    banner.querySelector('strong').textContent = 'In attesa dell’avversario…';
    return;
  }
  if (roomState.status === 'playing') {
    banner.classList.add(roomState.turn.toLowerCase());
    const mine = roomState.turn === roomState.ownSymbol;
    banner.querySelector('strong').textContent = mine ? `Tocca a te: gioca ${roomState.ownSymbol}` : `Turno dell’avversario (${roomState.turn})`;
    return;
  }
  banner.querySelector('strong').textContent = roomState.status === 'draw' ? 'Partita terminata in pareggio' : `Ha vinto ${roomState.winner}`;
}

function renderResult() {
  const panel = $('#result-panel');
  const finished = ['won', 'draw'].includes(roomState.status);
  panel.classList.toggle('hidden', !finished);
  if (!finished) return;
  const ownWin = roomState.status === 'won' && roomState.winner === roomState.ownSymbol;
  const opponent = roomState.players.find(player => player.symbol !== roomState.ownSymbol)?.name || 'L’avversario';
  $('#result-icon').textContent = roomState.status === 'draw' ? '＝' : ownWin ? '♛' : '◇';
  $('#result-title').textContent = roomState.status === 'draw' ? 'Pareggio!' : ownWin ? 'Hai vinto!' : `${opponent} ha vinto`;
  $('#result-copy').textContent = roomState.status === 'draw' ? 'Bella partita. Prova a prenderti il prossimo round.' : ownWin ? 'Tre simboli in fila: partita perfetta.' : 'Puoi chiedere subito la rivincita.';
  const button = $('#rematch-button');
  button.disabled = rematchRequested;
  button.querySelector('span').textContent = rematchRequested ? `In attesa… (${roomState.rematchVotes}/2)` : 'Rivincita';
}

function renderRoom() {
  if (!roomState) return;
  showView('game-view');
  $('#queue-overlay').classList.add('hidden');
  queued = false;
  $('#room-code').textContent = roomState.code;
  $('#round-label').textContent = `ROUND ${roomState.round}`;
  $('#game-title').textContent = roomState.status === 'waiting' ? 'Invita un amico' : 'Partita in corso';
  renderPlayer('X'); renderPlayer('O'); renderBoard(); renderStatus(); renderResult();
}

function returnToLobby() {
  roomState = null;
  rematchRequested = false;
  $('#result-panel').classList.add('hidden');
  showView('lobby-view');
}

$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#player-name').value.trim();
  $('#login-error').textContent = '';
  ensureAudio(); playSound('click');
  socket.emit('login', name);
});

$('#quick-match').addEventListener('click', () => { playSound('click'); socket.emit('quickMatch'); });
$('#cancel-queue').addEventListener('click', () => socket.emit('cancelQueue'));
$('#create-room').addEventListener('click', () => { playSound('click'); socket.emit('createRoom'); });
$('#join-room').addEventListener('click', () => {
  const code = $('#room-code-input').value.trim().toUpperCase();
  if (!code) return toast('Inserisci il codice della stanza.');
  playSound('click'); socket.emit('joinRoom', code);
});
$('#room-code-input').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#room-code-input').addEventListener('keydown', event => { if (event.key === 'Enter') $('#join-room').click(); });

$$('#board [data-cell]').forEach(cell => cell.addEventListener('click', () => {
  if (!roomState || roomState.turn !== roomState.ownSymbol) return;
  socket.emit('move', Number(cell.dataset.cell));
}));

$('#leave-room').addEventListener('click', () => { socket.emit('leaveRoom'); returnToLobby(); });
$('#rematch-button').addEventListener('click', () => {
  if (rematchRequested) return;
  rematchRequested = true; playSound('click'); socket.emit('rematch'); renderResult();
});
$('#copy-code').addEventListener('click', async () => {
  if (!roomState?.code) return;
  try { await navigator.clipboard.writeText(roomState.code); toast('Codice stanza copiato!'); }
  catch { toast(`Codice stanza: ${roomState.code}`); }
});
$('#sound-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('tris-sound', soundEnabled ? 'on' : 'off');
  $('#sound-toggle').textContent = soundEnabled ? '♪' : '×';
  $('#sound-toggle').setAttribute('aria-label', soundEnabled ? 'Disattiva suoni' : 'Attiva suoni');
  if (soundEnabled) playSound('click');
});

socket.on('loggedIn', data => {
  const wasReconnecting = reconnecting;
  playerName = data.name;
  localStorage.setItem('tris-player-name', playerName);
  $('#player-label').textContent = playerName;
  $('#login-error').textContent = '';
  reconnecting = false;
  if (wasReconnecting) { roomState = null; rematchRequested = false; toast('Connessione ripristinata. Puoi iniziare una nuova partita.'); }
  showView('lobby-view');
});
socket.on('loginError', message => { $('#login-error').textContent = message; playSound('error'); });
socket.on('actionError', message => { toast(message); playSound('error'); });
socket.on('presence', data => { $('#online-count').textContent = data.online; });
socket.on('queueState', data => {
  queued = data.waiting;
  $('#queue-overlay').classList.toggle('hidden', !queued);
});
socket.on('roomState', next => {
  const previous = roomState;
  roomState = next;
  if (!previous || previous.round !== next.round) rematchRequested = false;
  const changedIndex = previous?.board.findIndex((mark, index) => mark !== next.board[index]);
  if (changedIndex >= 0 && next.board[changedIndex]) playSound(next.board[changedIndex] === 'X' ? 'moveX' : 'moveO');
  const justWon = previous?.status === 'playing' && next.status === 'won';
  renderRoom();
  if (justWon && next.winner === next.ownSymbol) confetti();
});
socket.on('gameMessage', data => {
  if (data.tone === 'start') playSound('start');
  if (data.tone === 'win') playSound('win');
  if (data.tone === 'draw') playSound('draw');
  if (['leave', 'wait'].includes(data.tone)) toast(data.text);
});
socket.on('disconnect', () => {
  $('#queue-overlay').classList.add('hidden');
  toast('Connessione interrotta. Riprovo automaticamente…');
  reconnecting = Boolean(playerName);
});
socket.on('connect', () => {
  if (reconnecting && playerName) socket.emit('login', playerName);
});

$('#player-name').value = localStorage.getItem('tris-player-name') || '';
$('#sound-toggle').textContent = soundEnabled ? '♪' : '×';
