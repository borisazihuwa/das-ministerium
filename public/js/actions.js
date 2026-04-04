// ============================================================
// Das Ministerium — Action Execution
// ============================================================

import {
  ACTIONS, ACTION_INFO, AUFTRAG_COST, STURZ_COST
} from './constants.js';
import {
  transferCoins, getInfluence, reshuffleDeck, addLog, getPlayerById
} from './gameState.js';

// Check if an action is available for a player
export function getAvailableActions(state, player) {
  const available = [];

  for (const [actionId, info] of Object.entries(ACTION_INFO)) {
    if (canPerformAction(state, player, actionId)) {
      available.push(actionId);
    }
  }

  return available;
}

export function canPerformAction(state, player, actionId) {
  const info = ACTION_INFO[actionId];
  if (!info) return false;

  // Check coin cost (Auftrag=3, Sturz=7) — can't spend what you don't have
  if (info.coinCost > 0 && player.coins < info.coinCost) return false;

  // No potMin check — all actions are always available (bluffing is allowed).
  // If pot is low, you simply get fewer coins.

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

  reshuffleDeck(state);
  const drawn = [];
  for (let i = 0; i < 2 && state.deck.length > 0; i++) {
    drawn.push(state.deck.pop());
  }
  return drawn; // Returns drawn cards; player sees all 4 (own 2 + drawn 2)
}

// Complete Karten tauschen — player chose which 2 to keep
export function completePolitikerSwap(state, playerId, keptCards, returnedCards) {
  const player = getPlayerById(state, playerId);
  if (!player) return;

  // Replace player's cards with kept ones
  const unrevealed = player.cards.filter(c => !c.revealed);
  const revealed = player.cards.filter(c => c.revealed);

  player.cards = [
    ...keptCards.map(role => ({ role, revealed: false })),
    ...revealed
  ];

  // Return cards to deck
  for (const role of returnedCards) {
    state.deck.push(role);
  }
  state.deck = [...state.deck].sort(() => Math.random() - 0.5);

  addLog(state, `${player.name} hat 2 Karten behalten und 2 zurückgelegt.`);
}
