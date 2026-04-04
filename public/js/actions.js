// ============================================================
// Das Ministerium — Action Execution
// ============================================================

import {
  ACTIONS, ACTION_INFO, AUFTRAG_COST, STURZ_COST
} from './constants.js';
import {
  transferCoins, getInfluence, reshuffleDeck, addLog, getPlayerById, shuffle
} from './gameState.js';

// All actions + their availability reason (for greyed-out tooltips)
export function getAvailableActions(state, player) {
  const available = [];

  for (const [actionId, info] of Object.entries(ACTION_INFO)) {
    if (canPerformAction(state, player, actionId)) {
      available.push(actionId);
    }
  }

  return available;
}

// Returns { available: bool, reason: string } for tooltip display
export function getActionAvailability(state, player, actionId) {
  const info = ACTION_INFO[actionId];
  if (!info) return { available: false, reason: 'Unbekannte Aktion' };

  if (info.coinCost > 0 && player.coins < info.coinCost)
    return { available: false, reason: `Nicht genug Münzen (${info.coinCost} benötigt)` };

  if (info.potMin > 0 && state.pot < info.potMin)
    return { available: false, reason: `Pot zu leer (${info.potMin} benötigt)` };

  if (info.requiresTarget) {
    const targets = getValidTargets(state, player, actionId);
    if (targets.length === 0)
      return { available: false, reason: 'Kein gültiges Ziel' };
  }

  return { available: true, reason: '' };
}

export function canPerformAction(state, player, actionId) {
  const info = ACTION_INFO[actionId];
  if (!info) return false;

  // Check coin cost (Auftrag=3, Sturz=7)
  if (info.coinCost > 0 && player.coins < info.coinCost) return false;

  // Check pot minimum — Bürgergeld needs 1, Subvention needs 2, Steuern needs 3
  if (info.potMin > 0 && state.pot < info.potMin) return false;

  // Check target availability for targeted actions
  if (info.requiresTarget) {
    const targets = getValidTargets(state, player, actionId);
    if (targets.length === 0) return false;
  }

  return true;
}

// Get valid targets for a targeted action
export function getValidTargets(state, player, actionId) {
  return state.players.filter(p => {
    if (p.id === player.id) return false;
    if (p.eliminated || state.metaEliminated.includes(p.id)) return false;
    if (getInfluence(p) === 0) return false;

    // Stehlen: target must have at least 1 coin
    if (actionId === ACTIONS.STEHLEN && p.coins < 1) return false;

    return true;
  });
}

// Execute an action (after all reactions resolved, action confirmed)
export function executeAction(state, playerId, actionId, targetId, roleGuess) {
  const player = getPlayerById(state, playerId);
  if (!player) return false;

  const info = ACTION_INFO[actionId];
  const target = targetId ? getPlayerById(state, targetId) : null;

  switch (actionId) {
    case ACTIONS.BUERGERGELD: {
      const amount = transferCoins(state, 'pot', playerId, 1);
      addLog(state, `${player.name} nimmt Bürgergeld: +${amount} Münze aus dem Pot.`);
      return true;
    }

    case ACTIONS.SUBVENTION: {
      const amount = transferCoins(state, 'pot', playerId, 2);
      addLog(state, `${player.name} erhält Subvention: +${amount} Münzen aus dem Pot.`);
      return true;
    }

    case ACTIONS.STEUERN: {
      const amount = transferCoins(state, 'pot', playerId, 3);
      addLog(state, `${player.name} treibt Steuern ein (Finanzamt): +${amount} Münzen aus dem Pot.`);
      return true;
    }

    case ACTIONS.KARTEN_TAUSCHEN: {
      // Draw 2, see all 4, keep 2, return 2 — handled via UI/AI
      addLog(state, `${player.name} tauscht Karten (Politiker).`);
      return true; // actual swap handled separately
    }

    case ACTIONS.STEHLEN: {
      if (!target) return false;
      const amount = transferCoins(state, targetId, playerId, 2);
      addLog(state, `${player.name} stiehlt ${amount} Münzen von ${target.name} (Dieb).`);
      return true;
    }

    case ACTIONS.AUFTRAG: {
      // 3 coins already paid to bank during announcement
      if (!target) return false;
      addLog(state, `${player.name} erteilt Auftrag gegen ${target.name} (Gangster).`);
      // Target loses a card — handled by caller (card choice needed)
      return true;
    }

    case ACTIONS.STURZ: {
      // 7 coins already paid to pot during announcement
      if (!target || !roleGuess) return false;
      // Check if target has the guessed role
      const matchingCard = target.cards.find(c => !c.revealed && c.role === roleGuess);
      if (matchingCard) {
        matchingCard.revealed = true;
        state.discardPile.push(matchingCard.role);
        addLog(state, `${player.name} stürzt ${target.name} — ${roleGuess} erraten! Karte verloren.`);
        return true;
      } else {
        addLog(state, `${player.name} stürzt ${target.name} — ${roleGuess} falsch geraten. Keine Strafe.`);
        return false; // 7 coins stay in pot regardless
      }
    }

    default:
      return false;
  }
}

// Pay action costs upfront (before reactions)
export function payActionCost(state, playerId, actionId) {
  const info = ACTION_INFO[actionId];
  const player = getPlayerById(state, playerId);

  if (info.coinCost > 0) {
    if (info.coinTarget === 'bank') {
      transferCoins(state, playerId, 'bank', info.coinCost);
      addLog(state, `${player.name} zahlt ${info.coinCost} Münzen in die Bank.`);
    } else if (info.coinTarget === 'pot') {
      transferCoins(state, playerId, 'pot', info.coinCost);
      addLog(state, `${player.name} zahlt ${info.coinCost} Münzen in den Pot.`);
    }
  }
}

// Execute Karten tauschen (Politiker) — draw phase
export function drawCardsForPolitiker(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player) return [];

  const unrevealedCount = player.cards.filter(c => !c.revealed).length;

  reshuffleDeck(state);
  const drawn = [];
  // Draw same number of cards as unrevealed cards (1 or 2)
  const drawCount = Math.min(unrevealedCount, 2);
  for (let i = 0; i < drawCount && state.deck.length > 0; i++) {
    drawn.push(state.deck.pop());
  }
  return drawn;
}

// Complete Karten tauschen — player chose which to keep
export function completePolitikerSwap(state, playerId, keptCards, returnedCards) {
  const player = getPlayerById(state, playerId);
  if (!player) return;

  const unrevealedCount = player.cards.filter(c => !c.revealed).length;
  const revealed = player.cards.filter(c => c.revealed);

  // Keep exactly as many cards as the player had unrevealed (1 or 2)
  const actualKept = keptCards.slice(0, unrevealedCount);
  const actualReturned = [...keptCards.slice(unrevealedCount), ...returnedCards];

  // Player always has exactly 2 card slots total
  player.cards = [
    ...actualKept.map(role => ({ role, revealed: false })),
    ...revealed
  ];

  // Return unused cards to deck
  for (const role of actualReturned) {
    state.deck.push(role);
  }
  state.deck = shuffle(state.deck);

  addLog(state, `${player.name} hat Karten getauscht und ${actualKept.length} behalten.`);
}
