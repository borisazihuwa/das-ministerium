// ============================================================
// Das Ministerium — Game Server (Express + Socket.IO)
// ============================================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const http = createServer(app);
const io = new Server(http);

app.use(express.static(join(__dirname, 'public')));

// ---- Game State Imports (inline for Node.js compatibility) ----

const ROLES = { FINANZAMT: 'Finanzamt', POLITIKER: 'Politiker', DIEB: 'Dieb', GANGSTER: 'Gangster', POLIZIST: 'Polizist' };
const ROLE_LIST = Object.values(ROLES);
const CARDS_PER_ROLE = 3;
const START_COINS = 10;
const TOTAL_COINS = 50;
const ABGABE_COST = 1;
const AUFTRAG_COST = 3;
const STURZ_COST = 7;
const ANZEIGE_COST = 1;
const ANZEIGE_FAIL_EXTRA_COST = 1;
const MIN_BESTECHUNG_ANZEIGE = 2;
const MIN_BESTECHUNG_STURZ = 1;
const WINNER_CAP = 10;
const REDISTRIBUTION = 1;

const ACTIONS = {
  BUERGERGELD: 'buergergeld', SUBVENTION: 'subvention', STEUERN: 'steuern',
  KARTEN_TAUSCHEN: 'karten_tauschen', STEHLEN: 'stehlen', AUFTRAG: 'auftrag', STURZ: 'sturz'
};

const AI_PROFILES = {
  schwach: { anzeigeRate: 0.22, bluffRate: 0.28, blockRate: 0.28, auftragRate: 0.38, sturzRate: 0.30, bestechungAnbieten: 0.28, bestechungAnnehmen: 0.58, zieltAufSchwächsten: 0.45 },
  mittel: { anzeigeRate: 0.40, bluffRate: 0.44, blockRate: 0.48, auftragRate: 0.58, sturzRate: 0.48, bestechungAnbieten: 0.48, bestechungAnnehmen: 0.44, zieltAufSchwächsten: 0.68 },
  stark: { anzeigeRate: 0.56, bluffRate: 0.58, blockRate: 0.68, auftragRate: 0.72, sturzRate: 0.62, bestechungAnbieten: 0.62, bestechungAnnehmen: 0.36, zieltAufSchwächsten: 0.80 }
};

// ---- Lobby System ----

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck() {
  const deck = [];
  for (const role of ROLE_LIST) {
    for (let i = 0; i < CARDS_PER_ROLE; i++) deck.push(role);
  }
  return shuffle(deck);
}

function createRoom(hostSocket, hostName) {
  const code = generateCode();
  const room = {
    code,
    hostId: hostSocket.id,
    players: [{
      id: 0,
      name: hostName,
      socketId: hostSocket.id,
      isBot: false,
      aiProfile: null
    }],
    started: false,
    gameState: null,
    nextPlayerId: 1,
    pendingAction: null,
    reactionState: 'idle',
    actionTimeout: null,
    reactionTimeout: null
  };
  rooms.set(code, room);
  return room;
}

function sanitizeStateForPlayer(gameState, socketId) {
  if (!gameState) return null;
  return {
    ...gameState,
    deck: undefined,
    players: gameState.players.map(p => ({
      ...p,
      cards: p.cards.map(c => {
        if (c.revealed) return c;
        if (p.socketId === socketId) return c;
        return { role: '?', revealed: false };
      })
    }))
  };
}

// ---- Socket.IO Handlers ----

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('create_lobby', ({ name }) => {
    const room = createRoom(socket, name || 'Spieler');
    socket.join(room.code);
    socket.emit('lobby_created', { code: room.code, players: room.players });
  });

  socket.on('join_lobby', ({ code, name }) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return socket.emit('error', { message: 'Raum nicht gefunden.' });
    if (room.started) return socket.emit('error', { message: 'Spiel bereits gestartet.' });
    if (room.players.length >= 6) return socket.emit('error', { message: 'Raum ist voll.' });

    const player = {
      id: room.nextPlayerId++,
      name: name || `Spieler ${room.players.length + 1}`,
      socketId: socket.id,
      isBot: false,
      aiProfile: null
    };
    room.players.push(player);
    socket.join(room.code);

    io.to(room.code).emit('lobby_updated', { players: room.players });
    socket.emit('lobby_joined', { code: room.code, playerId: player.id });
  });

  socket.on('add_bot', ({ code, difficulty }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length >= 6) return socket.emit('error', { message: 'Raum ist voll.' });

    const botNames = ['Minister Schmidt', 'Rätin Müller', 'Sekretär Weber', 'Beamtin Fischer', 'Inspektor Koch'];
    const botCount = room.players.filter(p => p.isBot).length;
    const player = {
      id: room.nextPlayerId++,
      name: botNames[botCount] || `Bot ${botCount + 1}`,
      socketId: null,
      isBot: true,
      aiProfile: difficulty || 'mittel'
    };
    room.players.push(player);
    io.to(room.code).emit('lobby_updated', { players: room.players });
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Mindestens 2 Spieler.' });

    room.started = true;
    const deck = createDeck();
    const totalPlayerCoins = room.players.length * START_COINS;

    const gamePlayers = room.players.map(p => ({
      ...p,
      coins: START_COINS,
      cards: [
        { role: deck.pop(), revealed: false },
        { role: deck.pop(), revealed: false }
      ],
      eliminated: false
    }));

    room.gameState = {
      players: gamePlayers,
      bank: TOTAL_COINS - totalPlayerCoins,
      pot: 0,
      deck,
      discardPile: [],
      currentPlayerIndex: 0,
      phase: 'abgabe',
      round: 1,
      roundWinner: null,
      turnIndex: 0,
      reactionState: 'idle',
      log: ['=== Das Ministerium — Online-Spiel gestartet ==='],
      gameOver: false,
      winner: null,
      metaEliminated: []
    };

    // Send sanitized state to each player
    for (const p of room.players) {
      if (p.socketId) {
        io.to(p.socketId).emit('game_started', {
          state: sanitizeStateForPlayer(room.gameState, p.socketId),
          playerId: p.id
        });
      }
    }

    // Start the game loop
    runServerGameLoop(room);
  });

  socket.on('player_action', ({ code, actionId, targetId, roleGuess }) => {
    const room = rooms.get(code);
    if (!room || !room.gameState) return;

    const player = room.gameState.players.find(p => p.socketId === socket.id);
    if (!player) return;

    if (room._resolveAction) {
      room._resolveAction({ actionId, targetId, roleGuess });
    }
  });

  socket.on('player_reaction', ({ code, reaction, params }) => {
    const room = rooms.get(code);
    if (!room || !room.gameState) return;

    if (room._resolveReaction) {
      room._resolveReaction({ reaction, params });
    }
  });

  socket.on('player_card_choice', ({ code, cardIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    if (room._resolveCardChoice) {
      room._resolveCardChoice(cardIndex);
    }
  });

  socket.on('player_politiker_choice', ({ code, kept, returned }) => {
    const room = rooms.get(code);
    if (!room) return;

    if (room._resolvePolitiker) {
      room._resolvePolitiker({ kept, returned });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    // Mark player as disconnected in any room they were in
    for (const [code, room] of rooms) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.disconnected = true;
        io.to(code).emit('player_disconnected', { name: player.name });

        // If host disconnects and game not started, remove room
        if (room.hostId === socket.id && !room.started) {
          rooms.delete(code);
        }
      }
    }
  });
});

// ---- Server Game Loop ----

function broadcastState(room) {
  for (const p of room.players) {
    if (p.socketId && !p.disconnected) {
      io.to(p.socketId).emit('state_update', {
        state: sanitizeStateForPlayer(room.gameState, p.socketId)
      });
    }
  }
}

function addServerLog(gs, msg) {
  gs.log.push(msg);
}

function getInfluence(player) {
  return player.cards.filter(c => !c.revealed).length;
}

function transferCoins(gs, from, to, amount) {
  if (amount <= 0) return 0;
  let actual = amount;

  if (from === 'bank') { actual = Math.min(amount, gs.bank); gs.bank -= actual; }
  else if (from === 'pot') { actual = Math.min(amount, gs.pot); gs.pot -= actual; }
  else { const p = gs.players.find(x => x.id === from); if (!p) return 0; actual = Math.min(amount, p.coins); p.coins -= actual; }

  if (to === 'bank') gs.bank += actual;
  else if (to === 'pot') gs.pot += actual;
  else { const p = gs.players.find(x => x.id === to); if (p) p.coins += actual; }

  return actual;
}

function serverLoseCard(gs, playerId, cardIndex) {
  const player = gs.players.find(p => p.id === playerId);
  if (!player) return;
  const idx = cardIndex !== undefined
    ? player.cards.findIndex((c, i) => !c.revealed && i === cardIndex)
    : player.cards.findIndex(c => !c.revealed);
  if (idx >= 0) {
    player.cards[idx].revealed = true;
    gs.discardPile.push(player.cards[idx].role);
    addServerLog(gs, `${player.name} verliert Einfluss: ${player.cards[idx].role} aufgedeckt.`);
  }
}

function findNextActive(gs, from) {
  const n = gs.players.length;
  for (let i = 0; i < n; i++) {
    const idx = (from + i) % n;
    const p = gs.players[idx];
    if (!p.eliminated && !gs.metaEliminated.includes(p.id) && getInfluence(p) > 0) return idx;
  }
  return -1;
}

async function waitForPlayer(room, socketId, event, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const key = `_resolve${event.charAt(0).toUpperCase() + event.slice(1)}`;
    const timer = setTimeout(() => { room[key] = null; resolve(null); }, timeoutMs);
    room[key] = (data) => { clearTimeout(timer); room[key] = null; resolve(data); };

    // Ask player for input
    if (socketId) {
      io.to(socketId).emit(`request_${event}`, {
        state: sanitizeStateForPlayer(room.gameState, socketId)
      });
    }
  });
}

async function runServerGameLoop(room) {
  const gs = room.gameState;

  while (!gs.gameOver) {
    // Abgabe
    if (gs.phase === 'abgabe') {
      addServerLog(gs, `--- Runde ${gs.round} beginnt ---`);
      const alive = gs.players.filter(p => !gs.metaEliminated.includes(p.id));
      for (const p of alive) {
        if (p.coins > 0) {
          const paid = transferCoins(gs, p.id, 'pot', ABGABE_COST);
          if (paid > 0) addServerLog(gs, `${p.name} zahlt ${paid} Münze Abgabe.`);
        }
      }
      for (const p of alive) {
        if (p.coins === 0 && !gs.metaEliminated.includes(p.id)) {
          p.eliminated = true;
          gs.metaEliminated.push(p.id);
          addServerLog(gs, `${p.name} scheidet aus (0 Münzen nach Abgabe).`);
        }
      }

      const remaining = gs.players.filter(p => !gs.metaEliminated.includes(p.id));
      if (remaining.length <= 1) {
        gs.gameOver = true;
        gs.winner = remaining[0] || null;
        break;
      }

      gs.phase = 'actions';
      gs.currentPlayerIndex = findNextActive(gs, 0);
      broadcastState(room);
    }

    // Actions
    if (gs.phase === 'actions') {
      const activePlayers = gs.players.filter(p =>
        !gs.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) > 0
      );

      for (let turn = 0; turn < activePlayers.length; turn++) {
        if (gs.gameOver) break;
        const player = gs.players[gs.currentPlayerIndex];
        if (!player || player.eliminated || gs.metaEliminated.includes(player.id) || getInfluence(player) === 0) {
          gs.currentPlayerIndex = findNextActive(gs, gs.currentPlayerIndex + 1);
          if (gs.currentPlayerIndex < 0) break;
          continue;
        }

        broadcastState(room);
        let action;

        if (player.isBot) {
          await serverDelay(800);
          action = serverAiChooseAction(gs, player);
        } else {
          action = await waitForPlayer(room, player.socketId, 'action');
          if (!action) {
            // Timeout — default to Bürgergeld
            action = { actionId: ACTIONS.BUERGERGELD };
          }
        }

        // Execute with simplified server-side logic
        addServerLog(gs, `${player.name} spielt: ${action.actionId}`);

        // For simplicity, execute action directly in online mode
        // (A full implementation would mirror the reaction chain from reactions.js)
        serverExecuteAction(gs, player, action);
        broadcastState(room);

        // Check round end
        const loser = gs.players.find(p =>
          !gs.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) === 0
        );
        if (loser) {
          loser.eliminated = true;
          addServerLog(gs, `${loser.name} hat beide Karten verloren!`);
          const withCards = gs.players.filter(p =>
            !gs.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) > 0
          );
          if (withCards.length <= 1) {
            gs.roundWinner = withCards[0]?.id ?? null;
            gs.phase = 'pot_distribution';
            break;
          }
        }

        gs.currentPlayerIndex = findNextActive(gs, gs.currentPlayerIndex + 1);
        if (gs.currentPlayerIndex < 0) break;
      }

      if (gs.phase === 'actions') gs.phase = 'abgabe';
    }

    // Pot distribution
    if (gs.phase === 'pot_distribution') {
      if (gs.roundWinner !== null) {
        const winner = gs.players.find(p => p.id === gs.roundWinner);
        const winAmount = Math.min(WINNER_CAP, gs.pot);
        transferCoins(gs, 'pot', gs.roundWinner, winAmount);
        addServerLog(gs, `${winner.name} erhält ${winAmount} Münzen (Rundengewinner).`);

        const others = gs.players.filter(p => !gs.metaEliminated.includes(p.id) && p.id !== gs.roundWinner);
        for (const p of others) {
          const r = Math.min(REDISTRIBUTION, gs.pot);
          if (r > 0) transferCoins(gs, 'pot', p.id, r);
        }
      }

      for (const p of gs.players) {
        if (p.coins === 0 && !gs.metaEliminated.includes(p.id)) {
          p.eliminated = true;
          gs.metaEliminated.push(p.id);
        }
      }

      const remaining = gs.players.filter(p => !gs.metaEliminated.includes(p.id));
      if (remaining.length <= 1) {
        gs.gameOver = true;
        gs.winner = remaining[0] || null;
        break;
      }

      // New round
      gs.round++;
      gs.roundWinner = null;
      const allCards = [];
      for (const p of gs.players) { for (const c of p.cards) allCards.push(c.role); p.cards = []; }
      allCards.push(...gs.discardPile, ...gs.deck);
      gs.deck = shuffle(allCards);
      gs.discardPile = [];

      const alive = gs.players.filter(p => !gs.metaEliminated.includes(p.id));
      for (const p of alive) {
        p.cards = [{ role: gs.deck.pop(), revealed: false }, { role: gs.deck.pop(), revealed: false }];
        p.eliminated = false;
      }

      gs.currentPlayerIndex = findNextActive(gs, 0);
      gs.phase = 'abgabe';
      broadcastState(room);
    }
  }

  // Game over
  broadcastState(room);
  io.to(room.code).emit('game_over', { winner: gs.winner ? { name: gs.winner.name, coins: gs.winner.coins } : null });

  // Clean up room after delay
  setTimeout(() => rooms.delete(room.code), 60000);
}

function serverExecuteAction(gs, player, action) {
  switch (action.actionId) {
    case ACTIONS.BUERGERGELD:
      if (gs.pot >= 1) transferCoins(gs, 'pot', player.id, 1);
      break;
    case ACTIONS.SUBVENTION:
      if (gs.pot >= 2) transferCoins(gs, 'pot', player.id, 2);
      break;
    case ACTIONS.STEUERN:
      if (gs.pot >= 3) transferCoins(gs, 'pot', player.id, 3);
      break;
    case ACTIONS.STEHLEN: {
      const target = gs.players.find(p => p.id === action.targetId);
      if (target) transferCoins(gs, target.id, player.id, Math.min(2, target.coins));
      break;
    }
    case ACTIONS.AUFTRAG: {
      if (player.coins >= AUFTRAG_COST) {
        transferCoins(gs, player.id, 'bank', AUFTRAG_COST);
        const target = gs.players.find(p => p.id === action.targetId);
        if (target) {
          const idx = target.cards.findIndex(c => !c.revealed);
          if (idx >= 0) { target.cards[idx].revealed = true; gs.discardPile.push(target.cards[idx].role); }
        }
      }
      break;
    }
    case ACTIONS.STURZ: {
      if (player.coins >= STURZ_COST) {
        transferCoins(gs, player.id, 'pot', STURZ_COST);
        const target = gs.players.find(p => p.id === action.targetId);
        if (target && action.roleGuess) {
          const match = target.cards.find(c => !c.revealed && c.role === action.roleGuess);
          if (match) { match.revealed = true; gs.discardPile.push(match.role); }
        }
      }
      break;
    }
    case ACTIONS.KARTEN_TAUSCHEN: {
      // Simplified: just swap both cards
      const unrevealed = player.cards.filter(c => !c.revealed);
      for (const c of unrevealed) { gs.deck.push(c.role); }
      gs.deck = shuffle(gs.deck);
      for (const c of unrevealed) { c.role = gs.deck.pop(); }
      break;
    }
  }
}

function serverAiChooseAction(gs, player) {
  const profile = AI_PROFILES[player.aiProfile] || AI_PROFILES.mittel;
  const rand = Math.random;

  // Simple AI for server — mirrors client AI logic
  const targets = gs.players.filter(p => p.id !== player.id && !p.eliminated && !gs.metaEliminated.includes(p.id) && getInfluence(p) > 0);
  const targetWithCoins = targets.filter(t => t.coins > 0);
  const pickTarget = () => targets.length > 0 ? targets[Math.floor(rand() * targets.length)].id : null;

  if (player.coins >= STURZ_COST && rand() < profile.sturzRate * 0.3 && targets.length > 0) {
    return { actionId: ACTIONS.STURZ, targetId: pickTarget(), roleGuess: ROLE_LIST[Math.floor(rand() * ROLE_LIST.length)] };
  }
  if (player.coins >= AUFTRAG_COST && rand() < profile.auftragRate * 0.5 && targets.length > 0) {
    return { actionId: ACTIONS.AUFTRAG, targetId: pickTarget() };
  }
  if (targetWithCoins.length > 0 && rand() < 0.3) {
    return { actionId: ACTIONS.STEHLEN, targetId: targetWithCoins[Math.floor(rand() * targetWithCoins.length)].id };
  }
  if (gs.pot >= 3 && rand() < 0.3) return { actionId: ACTIONS.STEUERN };
  if (gs.pot >= 2 && rand() < 0.4) return { actionId: ACTIONS.SUBVENTION };
  if (gs.pot >= 1) return { actionId: ACTIONS.BUERGERGELD };
  return { actionId: ACTIONS.KARTEN_TAUSCHEN };
}

function serverDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Start Server ----

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Das Ministerium Server läuft auf Port ${PORT}`);
  console.log(`Öffne http://localhost:${PORT} im Browser`);
});
