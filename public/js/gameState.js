// ============================================================
// Das Ministerium — Game State Management
// ============================================================

import {
  ROLES, ROLE_LIST, CARDS_PER_ROLE, START_COINS, TOTAL_COINS,
  ABGABE_COST, WINNER_CAP, REDISTRIBUTION, RUNDENSTEUER, RUNDENSTEUER_DUEL, REACTION_STATES
} from './constants.js';

// Create a fresh deck of 15 cards (3 per role)
export function createDeck() {
  const deck = [];
  for (const role of ROLE_LIST) {
    for (let i = 0; i < CARDS_PER_ROLE; i++) {
      deck.push(role);
    }
  }
  return shuffle(deck);
}

// Fisher-Yates shuffle
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Create a player
export function createPlayer(id, name, isHuman = false, aiProfile = null) {
  return {
    id,
    name,
    coins: START_COINS,
    cards: [], // { role, revealed }
    isHuman,
    isBot: !isHuman,
    aiProfile, // 'schwach' | 'mittel' | 'stark' | null
    eliminated: false,
    socketId: null
  };
}

// Create initial game state
export function createGameState(players) {
  const deck = createDeck();
  const totalPlayerCoins = players.length * START_COINS;
  const bankCoins = TOTAL_COINS - totalPlayerCoins;

  // Deal 2 cards to each player
  const gamePlayers = players.map(p => {
    const player = { ...p, cards: [] };
    player.cards.push({ role: deck.pop(), revealed: false });
    player.cards.push({ role: deck.pop(), revealed: false });
    return player;
  });

  return {
    players: gamePlayers,
    bank: bankCoins,
    pot: 0,
    deck,
    discardPile: [],
    currentPlayerIndex: 0,
    phase: 'round_setup',
    round: 1,
    roundWinner: null,
    turnIndex: 0,
    reactionState: REACTION_STATES.IDLE,
    pendingAction: null,
    pendingReaction: null,
    log: [],
    gameOver: false,
    winner: null,
    metaEliminated: [] // players eliminated from the entire game (0 coins)
  };
}

// Get active players (still in the current round — have unrevealed cards)
export function getActivePlayers(state) {
  return state.players.filter(p => !p.eliminated && getInfluence(p) > 0);
}

// Get players still in the game (have coins or cards)
export function getAlivePlayersInGame(state) {
  return state.players.filter(p => !state.metaEliminated.includes(p.id));
}

// Get influence count (unrevealed cards)
export function getInfluence(player) {
  return player.cards.filter(c => !c.revealed).length;
}

// Player loses a card (reveals one of their choice)
export function loseCard(state, playerId, cardIndex) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  const unrevealed = player.cards.filter(c => !c.revealed);
  if (unrevealed.length === 0) return;

  // cardIndex refers to which unrevealed card (0 or 1)
  const actualIndex = cardIndex !== undefined
    ? player.cards.findIndex((c, i) => !c.revealed && i === cardIndex)
    : player.cards.findIndex(c => !c.revealed);

  if (actualIndex >= 0) {
    player.cards[actualIndex].revealed = true;
    state.discardPile.push(player.cards[actualIndex].role);
    addLog(state, `${player.name} verliert Einfluss: ${player.cards[actualIndex].role} aufgedeckt.`);
  }
}

// Transfer coins between entities
export function transferCoins(state, from, to, amount) {
  if (amount <= 0) return 0;

  let actualAmount = amount;
  let source, dest;

  // Resolve source
  if (from === 'bank') {
    actualAmount = Math.min(amount, state.bank);
    state.bank -= actualAmount;
  } else if (from === 'pot') {
    actualAmount = Math.min(amount, state.pot);
    state.pot -= actualAmount;
  } else {
    const player = state.players.find(p => p.id === from);
    if (!player) return 0;
    actualAmount = Math.min(amount, player.coins);
    player.coins -= actualAmount;
  }

  // Resolve destination
  if (to === 'bank') {
    state.bank += actualAmount;
  } else if (to === 'pot') {
    state.pot += actualAmount;
  } else {
    const player = state.players.find(p => p.id === to);
    if (player) player.coins += actualAmount;
  }

  return actualAmount;
}

// Phase 1: Abgabe — each player pays 1 coin to pot
export function executeAbgabe(state) {
  const alive = getAlivePlayersInGame(state);
  for (const player of alive) {
    if (player.coins > 0) {
      const paid = transferCoins(state, player.id, 'pot', ABGABE_COST);
      if (paid > 0) {
        addLog(state, `${player.name} zahlt ${paid} Münze Abgabe in den Pot.`);
      }
    }
  }

  // Eliminate players with 0 coins after Abgabe
  const eliminated = [];
  for (const player of alive) {
    if (player.coins === 0 && !state.metaEliminated.includes(player.id)) {
      player.eliminated = true;
      state.metaEliminated.push(player.id);
      eliminated.push(player);
      addLog(state, `${player.name} hat 0 Münzen nach der Abgabe und scheidet aus!`);
    }
  }

  return eliminated;
}

// Phase 3: Pot distribution + Rundensteuer
export function distributePot(state, roundWinnerId) {
  const winner = state.players.find(p => p.id === roundWinnerId);
  if (!winner) return;

  const activeMeta = state.players.filter(p =>
    !state.metaEliminated.includes(p.id) && p.id !== roundWinnerId
  );

  const aliveCount = activeMeta.length + 1; // +1 for winner

  // 1. Winner gets max 10 from pot
  const winnerAmount = Math.min(WINNER_CAP, state.pot);
  transferCoins(state, 'pot', roundWinnerId, winnerAmount);
  addLog(state, `${winner.name} erhält ${winnerAmount} Münzen aus dem Pot (Rundengewinner).`);

  // 2. Rundensteuer: each loser pays winner directly
  const taxAmount = aliveCount <= 2 ? RUNDENSTEUER_DUEL : RUNDENSTEUER;
  let totalTax = 0;
  for (const player of activeMeta) {
    const paid = transferCoins(state, player.id, roundWinnerId, taxAmount);
    if (paid > 0) totalTax += paid;
  }
  if (totalTax > 0) {
    addLog(state, `Rundensteuer: ${winner.name} erhält ${totalTax} Münzen von den Verlierern.`);
  }

  // 3. Redistribution (only with 3+ players)
  if (aliveCount >= 3) {
    for (const player of activeMeta) {
      const redistAmount = Math.min(REDISTRIBUTION, state.pot);
      if (redistAmount > 0) {
        transferCoins(state, 'pot', player.id, redistAmount);
        addLog(state, `${player.name} erhält ${redistAmount} Münze Redistribution.`);
      }
    }
  }

  if (state.pot > 0) {
    addLog(state, `${state.pot} Münzen verbleiben im Pot.`);
  }

  // 4. Eliminate players with 0 coins
  for (const player of state.players) {
    if (player.coins === 0 && !state.metaEliminated.includes(player.id)) {
      player.eliminated = true;
      state.metaEliminated.push(player.id);
      addLog(state, `${player.name} hat 0 Münzen und scheidet aus dem Spiel aus!`);
    }
  }
}

// Setup new round
export function setupNewRound(state) {
  state.round++;
  state.roundWinner = null;
  state.turnIndex = 0;
  state.currentPlayerIndex = 0;

  // Reshuffle all cards
  const allCards = [];
  for (const player of state.players) {
    for (const card of player.cards) {
      allCards.push(card.role);
    }
    player.cards = [];
  }
  // Add discard pile
  allCards.push(...state.discardPile);
  // Add remaining deck
  allCards.push(...state.deck);

  state.deck = shuffle(allCards);
  state.discardPile = [];

  // Deal 2 cards to each active player
  const alive = state.players.filter(p => !state.metaEliminated.includes(p.id));
  for (const player of alive) {
    player.cards = [
      { role: state.deck.pop(), revealed: false },
      { role: state.deck.pop(), revealed: false }
    ];
    player.eliminated = false;
  }

  // Find first non-eliminated player
  state.currentPlayerIndex = findNextActivePlayer(state, 0);
  state.phase = 'abgabe';
  addLog(state, `--- Runde ${state.round} beginnt ---`);
}

// Check if game is over
export function checkGameOver(state) {
  const alive = state.players.filter(p => !state.metaEliminated.includes(p.id));
  if (alive.length <= 1) {
    state.gameOver = true;
    state.winner = alive[0] || null;
    if (state.winner) {
      addLog(state, `🏆 ${state.winner.name} gewinnt das Spiel!`);
    }
    return true;
  }
  return false;
}

// Find next active player index (has cards and not eliminated)
export function findNextActivePlayer(state, fromIndex) {
  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const idx = (fromIndex + i) % n;
    const p = state.players[idx];
    if (!p.eliminated && !state.metaEliminated.includes(p.id) && getInfluence(p) > 0) {
      return idx;
    }
  }
  return -1;
}

// Reshuffle discard pile into deck when deck is empty
export function reshuffleDeck(state) {
  if (state.deck.length === 0 && state.discardPile.length > 0) {
    state.deck = shuffle([...state.discardPile]);
    state.discardPile = [];
    addLog(state, 'Nachziehstapel wurde neu gemischt.');
  }
}

// Swap a player's card back into deck and draw a new one
export function swapCard(state, playerId, cardIndex) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  reshuffleDeck(state);
  if (state.deck.length === 0) return;

  const oldRole = player.cards[cardIndex].role;
  state.deck.push(oldRole);
  state.deck = shuffle(state.deck);
  player.cards[cardIndex].role = state.deck.pop();
}

export function addLog(state, message) {
  state.log.push(message);
}

export function getPlayerById(state, id) {
  return state.players.find(p => p.id === id);
}
