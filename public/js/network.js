// ============================================================
// Das Ministerium — Network Client (Socket.IO)
// ============================================================

let socket = null;
let roomCode = null;
let myPlayerId = null;
let onStateUpdate = null;
let onGameOver = null;

export function initNetwork(callbacks) {
  onStateUpdate = callbacks.onStateUpdate;
  onGameOver = callbacks.onGameOver;
}

export function connect() {
  if (socket) return;

  // Dynamically load Socket.IO client
  return new Promise((resolve, reject) => {
    if (window.io) {
      socket = window.io();
      setupListeners();
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = () => {
      socket = window.io();
      setupListeners();
      resolve();
    };
    script.onerror = () => reject(new Error('Socket.IO konnte nicht geladen werden.'));
    document.head.appendChild(script);
  });
}

function setupListeners() {
  socket.on('lobby_created', ({ code, players }) => {
    roomCode = code;
    updateLobbyUI(code, players);
  });

  socket.on('lobby_joined', ({ code, playerId }) => {
    roomCode = code;
    myPlayerId = playerId;
  });

  socket.on('lobby_updated', ({ players }) => {
    updateLobbyUI(roomCode, players);
  });

  socket.on('error', ({ message }) => {
    alert(message);
  });

  socket.on('game_started', ({ state, playerId }) => {
    myPlayerId = playerId;
    if (onStateUpdate) onStateUpdate(state);
    // Switch to game screen
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
  });

  socket.on('state_update', ({ state }) => {
    if (onStateUpdate) onStateUpdate(state);
  });

  socket.on('request_action', ({ state }) => {
    if (onStateUpdate) onStateUpdate(state);
    // The UI will handle showing action selection
    document.dispatchEvent(new CustomEvent('request_action', { detail: { state } }));
  });

  socket.on('request_reaction', ({ state }) => {
    if (onStateUpdate) onStateUpdate(state);
    document.dispatchEvent(new CustomEvent('request_reaction', { detail: { state } }));
  });

  socket.on('request_cardChoice', ({ state }) => {
    if (onStateUpdate) onStateUpdate(state);
    document.dispatchEvent(new CustomEvent('request_card_choice', { detail: { state } }));
  });

  socket.on('request_politikerChoice', ({ state }) => {
    if (onStateUpdate) onStateUpdate(state);
    document.dispatchEvent(new CustomEvent('request_politiker_choice', { detail: { state } }));
  });

  socket.on('game_over', ({ winner }) => {
    if (onGameOver) onGameOver(winner);
  });

  socket.on('player_disconnected', ({ name }) => {
    console.log(`${name} hat die Verbindung verloren.`);
  });
}

function updateLobbyUI(code, players) {
  const lobbyArea = document.getElementById('lobby-area');
  lobbyArea.classList.remove('hidden');
  document.getElementById('lobby-code').textContent = code;

  const playersDiv = document.getElementById('lobby-players');
  playersDiv.innerHTML = '';
  for (const p of players) {
    const div = document.createElement('div');
    div.className = 'lobby-player';
    div.textContent = `${p.name}${p.isBot ? ` (Bot: ${p.aiProfile})` : ''}`;
    playersDiv.appendChild(div);
  }
}

// ---- Public API ----

export function createLobby(name) {
  if (socket) socket.emit('create_lobby', { name });
}

export function joinLobby(code, name) {
  if (socket) socket.emit('join_lobby', { code, name });
}

export function addBot(difficulty) {
  if (socket && roomCode) socket.emit('add_bot', { code: roomCode, difficulty });
}

export function startGame() {
  if (socket && roomCode) socket.emit('start_game', { code: roomCode });
}

export function sendAction(actionId, targetId, roleGuess) {
  if (socket && roomCode) {
    socket.emit('player_action', { code: roomCode, actionId, targetId, roleGuess });
  }
}

export function sendReaction(reaction, params) {
  if (socket && roomCode) {
    socket.emit('player_reaction', { code: roomCode, reaction, params });
  }
}

export function sendCardChoice(cardIndex) {
  if (socket && roomCode) {
    socket.emit('player_card_choice', { code: roomCode, cardIndex });
  }
}

export function sendPolitikerChoice(kept, returned) {
  if (socket && roomCode) {
    socket.emit('player_politiker_choice', { code: roomCode, kept, returned });
  }
}

export function getRoomCode() { return roomCode; }
export function getMyPlayerId() { return myPlayerId; }
export function isConnected() { return socket && socket.connected; }
