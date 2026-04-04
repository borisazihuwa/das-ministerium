// ============================================================
// Das Ministerium — Main Game Loop
// ============================================================

import {
  ACTIONS, ACTION_INFO, REACTION_STATES, MIN_PLAYERS, MAX_PLAYERS, AUFTRAG_COST
} from './constants.js';
import {
  createGameState, createPlayer, createDeck, shuffle,
  executeAbgabe, distributePot, checkGameOver,
  findNextActivePlayer, getActivePlayers, getAlivePlayersInGame,
  getInfluence, loseCard, addLog, getPlayerById, reshuffleDeck, transferCoins
} from './gameState.js';
import {
  getAvailableActions, executeAction, payActionCost,
  drawCardsForPolitiker, completePolitikerSwap
} from './actions.js';
import {
  createPendingAction, startReactionFlow, getReactingPlayers,
  getAvailableReactions, processReaction
} from './reactions.js';
import {
  aiChooseAction, aiChooseReaction, aiChooseCardToLose,
  aiChoosePolitikerCards, getAiDelay, getAiComment
} from './ai.js';
import {
  initUI, showMenu, hideMenu, showGameScreen, renderGameState,
  showActionSelection, showReactionSelection, showCardSelection,
  showPolitikerSwap, showNotification, showGameOver, hideActionPanel
} from './ui.js';
import { initLogger } from './logger.js';
import {
  connect, createLobby, joinLobby, addBot, startGame as startOnlineGame,
  sendAction, sendReaction, sendCardChoice, sendPolitikerChoice,
  initNetwork, getRoomCode
} from './network.js';

let state = null;
let isOnline = false;

// ---- INITIALIZATION ----

document.addEventListener('DOMContentLoaded', () => {
  initLogger(document.getElementById('game-log'));
  setupMenuHandlers();
  showMenu();
});

function setupMenuHandlers() {
  document.getElementById('btn-solo').addEventListener('click', () => {
    document.getElementById('solo-setup').classList.remove('hidden');
    document.getElementById('online-setup').classList.add('hidden');
  });

  document.getElementById('btn-online').addEventListener('click', () => {
    document.getElementById('online-setup').classList.remove('hidden');
    document.getElementById('solo-setup').classList.add('hidden');
  });

  document.getElementById('btn-start-solo').addEventListener('click', startSoloGame);

  // Bot count slider
  const slider = document.getElementById('bot-count');
  const label = document.getElementById('bot-count-label');
  if (slider && label) {
    slider.addEventListener('input', () => {
      label.textContent = slider.value;
    });
  }

  // Online multiplayer handlers
  document.getElementById('btn-create-lobby').addEventListener('click', async () => {
    await setupOnlineConnection();
    const name = document.getElementById('online-name').value.trim() || 'Spieler';
    createLobby(name);
  });

  document.getElementById('btn-join-lobby').addEventListener('click', async () => {
    await setupOnlineConnection();
    const name = document.getElementById('online-name').value.trim() || 'Spieler';
    const code = document.getElementById('room-code').value.trim().toUpperCase();
    if (code.length === 4) joinLobby(code, name);
  });

  document.getElementById('btn-add-bot').addEventListener('click', () => {
    const difficulty = document.getElementById('lobby-bot-difficulty').value;
    addBot(difficulty);
  });

  document.getElementById('btn-start-online').addEventListener('click', () => {
    startOnlineGame();
  });
}

async function setupOnlineConnection() {
  if (!window._networkInitialized) {
    initNetwork({
      onStateUpdate: (serverState) => {
        state = serverState;
        isOnline = true;
        renderGameState(state);
      },
      onGameOver: (winner) => {
        showGameOver(winner);
      }
    });
    await connect();
    window._networkInitialized = true;
  }
}

function startSoloGame() {
  const botCount = parseInt(document.getElementById('bot-count').value) || 3;
  const difficulty = document.getElementById('bot-difficulty').value || 'mittel';

  const players = [];

  // Human player
  const playerName = document.getElementById('player-name').value.trim() || 'Spieler';
  players.push(createPlayer(0, playerName, true, null));

  // Bot names
  const botNames = ['Minister Schmidt', 'Rätin Müller', 'Sekretär Weber', 'Beamtin Fischer', 'Inspektor Koch'];

  for (let i = 0; i < botCount; i++) {
    const profile = difficulty === 'gemischt'
      ? ['schwach', 'mittel', 'stark'][i % 3]
      : difficulty;
    players.push(createPlayer(i + 1, botNames[i] || `Bot ${i + 1}`, false, profile));
  }

  state = createGameState(players);
  isOnline = false;

  hideMenu();
  showGameScreen();

  addLog(state, `=== Das Ministerium — Neues Spiel ===`);
  addLog(state, `${players.length} Spieler. Viel Erfolg!`);

  runGameLoop();
}

// ---- GAME LOOP ----
// PRD flow per round:
//   1. Abgabe (Ante) — each alive player pays 1 coin to pot
//   2. Eliminate players with 0 coins (no cards dealt to them)
//   3. Deal cards — 2 per remaining player
//   4. Actions — clockwise turns until someone loses both cards
//   5. Pot distribution — winner gets max 10, others get 1 each
//   6. Eliminate players with 0 coins after distribution
//   7. Next round (or game over if ≤1 player left)

async function runGameLoop() {
  // Round 1: cards already dealt in createGameState, skip to abgabe
  addLog(state, `--- Runde ${state.round} beginnt ---`);
  renderGameState(state);

  while (!state.gameOver) {
    // === PHASE 1: ABGABE ===
    showNotification(`Runde ${state.round} — Abgabe`, 1500);
    await delay(1200);

    executeAbgabe(state);
    renderGameState(state);
    await delay(1000);

    if (checkGameOver(state)) break;

    // === PHASE 2: KARTENAUSGABE ===
    // Round 1: already dealt. Round 2+: deal new cards.
    if (state.round > 1) {
      dealNewCards(state);
      renderGameState(state);
      await delay(500);
    }

    // === PHASE 3: AKTIONSPHASE ===
    state.phase = 'actions';
    state.currentPlayerIndex = findNextActivePlayer(state, 0);
    showNotification(`Runde ${state.round} — Aktionen`, 1500);
    renderGameState(state);
    await delay(500);

    await runActionsPhase();
    if (state.gameOver) break;

    // === PHASE 4: POT-VERTEILUNG ===
    state.phase = 'pot_distribution';
    showNotification(`Runde ${state.round} — Pot-Verteilung`, 1500);
    renderGameState(state);
    await delay(1000);

    if (state.roundWinner !== null) {
      distributePot(state, state.roundWinner);
    }
    renderGameState(state);
    await delay(1500);

    if (checkGameOver(state)) break;

    // === NÄCHSTE RUNDE ===
    state.round++;
    state.roundWinner = null;
    state.phase = 'abgabe';
    addLog(state, `--- Runde ${state.round} beginnt ---`);
    renderGameState(state);
    await delay(800);
  }

  // Game over
  renderGameState(state);
  showGameOver(state.winner);
}

// Deal new cards for a new round (Round 2+)
function dealNewCards(state) {
  // Collect all cards back
  const allCards = [];
  for (const player of state.players) {
    for (const card of player.cards) {
      allCards.push(card.role);
    }
    player.cards = [];
  }
  allCards.push(...state.discardPile, ...state.deck);

  state.deck = shuffle(allCards);
  state.discardPile = [];

  // Deal 2 cards only to players still in the game (not meta-eliminated)
  const alive = state.players.filter(p => !state.metaEliminated.includes(p.id));
  for (const player of alive) {
    player.cards = [
      { role: state.deck.pop(), revealed: false },
      { role: state.deck.pop(), revealed: false }
    ];
    player.eliminated = false;
  }

  addLog(state, `Karten ausgeteilt an ${alive.length} Spieler.`);
}

async function runActionsPhase() {
  // Actions continue in a loop until someone loses both cards (round ends)
  while (true) {
    if (state.gameOver) return;

    const player = state.players[state.currentPlayerIndex];
    if (!player || player.eliminated || state.metaEliminated.includes(player.id) || getInfluence(player) === 0) {
      state.currentPlayerIndex = findNextActivePlayer(state, state.currentPlayerIndex + 1);
      if (state.currentPlayerIndex < 0) break;
      continue;
    }

    renderGameState(state);

    // Get action from player
    let actionChoice;
    if (player.isHuman) {
      showNotification(`Dein Zug, ${player.name}!`, 1500);
      actionChoice = await showActionSelection(state, player);
    } else {
      // Slower AI actions with announcement delay
      showNotification(`${player.name} überlegt...`, 1200);
      await delay(1200 + Math.random() * 800);
      actionChoice = aiChooseAction(state, player);
    }

    if (!actionChoice) {
      state.currentPlayerIndex = findNextActivePlayer(state, state.currentPlayerIndex + 1);
      if (state.currentPlayerIndex < 0) break;
      continue;
    }

    // Announce action
    const info = ACTION_INFO[actionChoice.actionId];
    const target = actionChoice.targetId ? getPlayerById(state, actionChoice.targetId) : null;
    let announcement = `${player.name} spielt: ${info.name}`;
    if (target) announcement += ` gegen ${target.name}`;
    if (actionChoice.roleGuess) announcement += ` (vermutet: ${actionChoice.roleGuess})`;
    addLog(state, announcement);

    // AI comment
    if (player.isBot) {
      const comment = getAiComment('action_taken', player.aiProfile);
      if (comment) addLog(state, `  💬 ${player.name}: "${comment}"`);
    }

    // Pay upfront costs
    payActionCost(state, player.id, actionChoice.actionId);
    renderGameState(state);

    // Create pending action and start reaction flow
    const pending = createPendingAction(
      player.id,
      actionChoice.actionId,
      actionChoice.targetId,
      actionChoice.roleGuess,
      info.requiresRole
    );
    state.pendingAction = pending;
    startReactionFlow(state, pending);

    // Process reactions
    await processReactionChain(pending);

    // Resolve action
    if (pending.actionSucceeds) {
      if (actionChoice.actionId === ACTIONS.KARTEN_TAUSCHEN) {
        await handlePolitikerSwap(player);
      } else if (actionChoice.actionId === ACTIONS.AUFTRAG) {
        await handleAuftragLoseCard(state, actionChoice.targetId);
      } else {
        executeAction(state, player.id, actionChoice.actionId, actionChoice.targetId, actionChoice.roleGuess);
      }
    } else {
      addLog(state, `Aktion von ${player.name} schlägt fehl.`);
      // Auftrag: refund 3 coins from bank IF the Gangster claim was correctly challenged
      // PRD: "Wenn Anzeige des Gangster-Anspruchs korrekt ist, gehen die 3 Münzen zurück"
      if (actionChoice.actionId === ACTIONS.AUFTRAG && pending._targetMustLoseCard && !pending.blocked) {
        transferCoins(state, 'bank', player.id, AUFTRAG_COST);
        addLog(state, `${player.name} erhält 3 Münzen zurück (Gangster-Anspruch widerlegt).`);
      }
    }

    // Handle pending card losses from Anzeige
    // (Doppelgefahr: challenger loses card here, target already lost card
    //  from the Auftrag execution above since actionSucceeds=true)
    if (pending._challengerMustLoseCard) {
      await handleLoseCard(state, pending.challengePlayerId);
    }
    if (pending._targetMustLoseCard) {
      await handleLoseCard(state, pending.challengeTarget);
    }

    state.pendingAction = null;
    state.reactionState = REACTION_STATES.IDLE;
    renderGameState(state);

    // Mark ALL players who lost their last card as eliminated this round
    for (const p of state.players) {
      if (!state.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) === 0) {
        p.eliminated = true;
        addLog(state, `${p.name} hat beide Karten verloren und ist raus aus dieser Runde!`);
      }
    }

    // Check: how many players still have cards?
    const withCards = state.players.filter(p =>
      !state.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) > 0
    );

    if (withCards.length <= 1) {
      // Round over — last player with cards wins
      state.roundWinner = withCards[0]?.id ?? null;
      if (state.roundWinner !== null) {
        addLog(state, `${getPlayerById(state, state.roundWinner).name} gewinnt die Runde!`);
      }
      state.phase = 'pot_distribution';
      renderGameState(state);
      return;
    }

    // Next player (clockwise, loops around)
    state.currentPlayerIndex = findNextActivePlayer(state, state.currentPlayerIndex + 1);
    if (state.currentPlayerIndex < 0) {
      // No active player found — shouldn't happen, but end round safely
      state.phase = 'pot_distribution';
      return;
    }

    await delay(500);
  }
}

async function processReactionChain(pending) {
  while (state.reactionState !== REACTION_STATES.RESOLVING) {
    const reactors = getReactorsForCurrentState(pending);

    if (reactors.length === 0) {
      // No one can react → resolve
      if (state.reactionState === REACTION_STATES.AWAITING_REACTIONS) {
        pending.actionSucceeds = true;
      }
      state.reactionState = REACTION_STATES.RESOLVING;
      break;
    }

    let reactionOccurred = false;

    for (const reactor of reactors) {
      const reactions = getAvailableReactions(state, pending, reactor.id);
      if (reactions.length === 0) continue;

      let choice;
      if (reactor.isHuman) {
        choice = await showReactionSelection(state, pending, reactor);
      } else {
        await delay(getAiDelay());
        choice = aiChooseReaction(state, pending, reactor);
      }

      if (!choice) continue;

      processReaction(state, pending, reactor.id, choice.reaction, choice.params || {});
      renderGameState(state);

      if (choice.reaction !== 'pass') {
        reactionOccurred = true;
        // Pause so player can read what happened
        await delay(1500);
        break; // First reactor claims the reaction
      }
    }

    if (!reactionOccurred && state.reactionState !== REACTION_STATES.RESOLVING) {
      // Everyone passed
      if (state.reactionState === REACTION_STATES.AWAITING_REACTIONS) {
        pending.actionSucceeds = true;
      } else if (state.reactionState === REACTION_STATES.AWAITING_ANZEIGE_ON_BLOCK) {
        pending.actionSucceeds = false; // Block stands
      }
      state.reactionState = REACTION_STATES.RESOLVING;
    }

    await delay(800);
  }
}

function getReactorsForCurrentState(pending) {
  if (state.reactionState === REACTION_STATES.AWAITING_REACTIONS) {
    return getReactingPlayers(state, pending);
  }
  if (state.reactionState === REACTION_STATES.AWAITING_ANZEIGE_ON_BLOCK) {
    const actor = getPlayerById(state, pending.playerId);
    return actor && getInfluence(actor) > 0 ? [actor] : [];
  }
  if (state.reactionState === REACTION_STATES.AWAITING_BESTECHUNG) {
    const target = getPlayerById(state, pending.challengeTarget);
    return target && getInfluence(target) > 0 ? [target] : [];
  }
  if (state.reactionState === REACTION_STATES.AWAITING_BESTECHUNG_DECISION) {
    const challenger = getPlayerById(state, pending.challengePlayerId);
    return challenger ? [challenger] : [];
  }
  if (state.reactionState === REACTION_STATES.AWAITING_STURZ_BESTECHUNG) {
    const target = getPlayerById(state, pending.targetId);
    return target && getInfluence(target) > 0 ? [target] : [];
  }
  if (state.reactionState === REACTION_STATES.AWAITING_STURZ_BESTECHUNG_DECISION) {
    const attacker = getPlayerById(state, pending.playerId);
    return attacker ? [attacker] : [];
  }
  return [];
}

async function handlePolitikerSwap(player) {
  const currentRoles = player.cards.filter(c => !c.revealed).map(c => c.role);
  const drawnRoles = drawCardsForPolitiker(state, player.id);

  if (drawnRoles.length === 0) {
    addLog(state, 'Kein Kartenstapel vorhanden zum Tauschen.');
    return;
  }

  let result;
  if (player.isHuman) {
    result = await showPolitikerSwap(player, drawnRoles);
  } else {
    await delay(getAiDelay());
    result = aiChoosePolitikerCards(player, currentRoles, drawnRoles);
  }

  completePolitikerSwap(state, player.id, result.kept, result.returned);
  renderGameState(state);
}

async function handleAuftragLoseCard(state, targetId) {
  const target = getPlayerById(state, targetId);
  if (!target || getInfluence(target) === 0) return;

  await handleLoseCard(state, targetId);
}

async function handleLoseCard(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player || getInfluence(player) === 0) return;

  let cardIndex;
  if (player.isHuman) {
    cardIndex = await showCardSelection(player, `${player.name}: Welche Karte verlieren?`);
  } else {
    await delay(getAiDelay());
    cardIndex = aiChooseCardToLose(player);
  }

  loseCard(state, playerId, cardIndex);
  renderGameState(state);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for online mode
export { state, isOnline };
