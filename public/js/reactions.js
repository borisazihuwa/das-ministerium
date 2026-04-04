// ============================================================
// Das Ministerium — Reaction System (State Machine)
// ============================================================
//
// Flow:
// 1. Action announced → AWAITING_REACTIONS
//    - Players can: Block, Anzeige, or Pass
// 2. Block announced → AWAITING_ANZEIGE_ON_BLOCK
//    - Action player can: Anzeige the block, or Accept (action fails)
// 3. Anzeige raised → AWAITING_BESTECHUNG
//    - Target can: offer Bestechung, or reveal card
// 4. Bestechung offered → AWAITING_BESTECHUNG_DECISION
//    - Challenger decides: accept (anzeige dropped) or decline (card reveal)
// 5. Sturz announced → AWAITING_STURZ_BESTECHUNG
//    - Target can bribe attacker
//
// Resolution determines if action succeeds or fails.

import {
  ACTIONS, ACTION_INFO, BLOCK_MATRIX, REACTION_STATES,
  ANZEIGE_COST, ANZEIGE_FAIL_EXTRA_COST,
  MIN_BESTECHUNG_ANZEIGE, MIN_BESTECHUNG_STURZ, ROLES
} from './constants.js';
import {
  transferCoins, loseCard, getInfluence, addLog, getPlayerById, swapCard, shuffle
} from './gameState.js';

// Create a pending action context
export function createPendingAction(playerId, actionId, targetId = null, roleGuess = null, claimedRole = null) {
  return {
    playerId,
    actionId,
    targetId,
    roleGuess,
    claimedRole: claimedRole || ACTION_INFO[actionId]?.requiresRole || null,
    blocked: false,
    blockPlayerId: null,
    blockClaimedRole: null,
    challenged: false,
    challengePlayerId: null,
    challengeTarget: null, // 'action' or 'block'
    bestechungOffer: 0,
    actionSucceeds: true,
    resolved: false,
    // Track who has passed reactions
    passedPlayers: new Set(),
    // For Doppelgefahr tracking
    doppelgefahr: false
  };
}

// Get players who can react to the current action (clockwise from actor)
export function getReactingPlayers(state, pending) {
  const info = ACTION_INFO[pending.actionId];
  const players = [];
  const n = state.players.length;
  const startIdx = state.players.findIndex(p => p.id === pending.playerId);

  for (let i = 1; i < n; i++) {
    const idx = (startIdx + i) % n;
    const p = state.players[idx];
    if (p.eliminated || state.metaEliminated.includes(p.id) || getInfluence(p) === 0) continue;
    if (pending.passedPlayers.has(p.id)) continue;
    players.push(p);
  }
  return players;
}

// Get available reactions for a player
export function getAvailableReactions(state, pending, playerId) {
  const reactions = [];
  const player = getPlayerById(state, playerId);
  if (!player || player.eliminated || getInfluence(player) === 0) return reactions;

  const info = ACTION_INFO[pending.actionId];

  if (state.reactionState === REACTION_STATES.AWAITING_REACTIONS) {
    // Can Anzeige if action is challengeable and player has coins
    if (info.challengeable && player.coins >= ANZEIGE_COST) {
      reactions.push('anzeige');
    }

    // Can Block if action is blockable
    if (info.blockable) {
      const blockInfo = BLOCK_MATRIX[pending.actionId];
      if (blockInfo) {
        if (blockInfo.anyoneCanBlock) {
          reactions.push('block');
        } else if (pending.targetId === playerId) {
          reactions.push('block');
        }
      }
    }

    reactions.push('pass');
  }

  if (state.reactionState === REACTION_STATES.AWAITING_ANZEIGE_ON_BLOCK) {
    // Only action player can challenge the block
    if (playerId === pending.playerId && player.coins >= ANZEIGE_COST) {
      reactions.push('anzeige_block');
    }
    reactions.push('accept_block');
  }

  if (state.reactionState === REACTION_STATES.AWAITING_BESTECHUNG) {
    // Anzeige target can offer Bestechung
    if (playerId === pending.challengeTarget) {
      const minBribe = MIN_BESTECHUNG_ANZEIGE;
      if (player.coins >= minBribe) {
        reactions.push('bestechung');
      }
      reactions.push('reveal_card');
    }
  }

  if (state.reactionState === REACTION_STATES.AWAITING_BESTECHUNG_DECISION) {
    // Challenger decides on bribe
    if (playerId === pending.challengePlayerId) {
      reactions.push('accept_bestechung');
      reactions.push('decline_bestechung');
    }
  }

  if (state.reactionState === REACTION_STATES.AWAITING_STURZ_BESTECHUNG) {
    // Sturz target can bribe
    if (playerId === pending.targetId) {
      if (player.coins >= MIN_BESTECHUNG_STURZ) {
        reactions.push('sturz_bestechung');
      }
      reactions.push('accept_sturz');
    }
  }

  if (state.reactionState === REACTION_STATES.AWAITING_STURZ_BESTECHUNG_DECISION) {
    if (playerId === pending.playerId) {
      reactions.push('accept_sturz_bestechung');
      reactions.push('decline_sturz_bestechung');
    }
  }

  return reactions;
}

// Process a reaction
export function processReaction(state, pending, playerId, reaction, params = {}) {
  const player = getPlayerById(state, playerId);

  switch (reaction) {
    case 'pass':
      pending.passedPlayers.add(playerId);
      // Check if all eligible players passed
      const reactors = getReactingPlayers(state, pending);
      if (reactors.length === 0) {
        // All passed — action succeeds
        state.reactionState = REACTION_STATES.RESOLVING;
        pending.actionSucceeds = true;
      }
      break;

    case 'anzeige':
      handleAnzeige(state, pending, playerId, 'action');
      break;

    case 'block': {
      const blockRole = params.blockRole;
      pending.blocked = true;
      pending.blockPlayerId = playerId;
      pending.blockClaimedRole = blockRole;
      state.reactionState = REACTION_STATES.AWAITING_ANZEIGE_ON_BLOCK;
      addLog(state, `${player.name} blockiert mit ${blockRole}!`);
      break;
    }

    case 'anzeige_block':
      handleAnzeige(state, pending, playerId, 'block');
      break;

    case 'accept_block':
      // Action fails due to uncontested block
      pending.actionSucceeds = false;
      state.reactionState = REACTION_STATES.RESOLVING;
      addLog(state, `${getPlayerById(state, pending.playerId).name} akzeptiert den Block.`);
      break;

    case 'bestechung': {
      const amount = params.amount || MIN_BESTECHUNG_ANZEIGE;
      pending.bestechungOffer = amount;
      state.reactionState = REACTION_STATES.AWAITING_BESTECHUNG_DECISION;
      addLog(state, `${player.name} bietet ${amount} Münzen Bestechung an.`);
      break;
    }

    case 'accept_bestechung':
      handleAcceptBestechung(state, pending);
      break;

    case 'decline_bestechung':
      handleDeclineBestechung(state, pending);
      break;

    case 'reveal_card':
      // Anzeige target chooses to reveal (no bribe)
      handleRevealCard(state, pending);
      break;

    case 'sturz_bestechung': {
      const amount = params.amount || MIN_BESTECHUNG_STURZ;
      pending.bestechungOffer = amount;
      state.reactionState = REACTION_STATES.AWAITING_STURZ_BESTECHUNG_DECISION;
      addLog(state, `${player.name} bietet ${amount} Münzen Bestechung gegen den Sturz an.`);
      break;
    }

    case 'accept_sturz_bestechung': {
      // Attacker accepts bribe, Sturz cancelled
      const target = getPlayerById(state, pending.targetId);
      const attacker = getPlayerById(state, pending.playerId);
      transferCoins(state, pending.targetId, pending.playerId, pending.bestechungOffer);
      addLog(state, `${attacker.name} nimmt die Bestechung an. Sturz abgewendet.`);
      pending.actionSucceeds = false;
      state.reactionState = REACTION_STATES.RESOLVING;
      break;
    }

    case 'decline_sturz_bestechung': {
      // Attacker declines, Sturz proceeds
      addLog(state, `${getPlayerById(state, pending.playerId).name} lehnt die Bestechung ab.`);
      pending.actionSucceeds = true;
      state.reactionState = REACTION_STATES.RESOLVING;
      break;
    }

    case 'accept_sturz':
      // Target accepts Sturz (no bribe)
      pending.actionSucceeds = true;
      state.reactionState = REACTION_STATES.RESOLVING;
      break;
  }

  return pending;
}

function handleAnzeige(state, pending, challengerId, target) {
  const challenger = getPlayerById(state, challengerId);

  // Pay 1 coin to pot
  transferCoins(state, challengerId, 'pot', ANZEIGE_COST);

  pending.challenged = true;
  pending.challengePlayerId = challengerId;

  if (target === 'action') {
    pending.challengeTarget = pending.playerId;
    addLog(state, `${challenger.name} zeigt ${getPlayerById(state, pending.playerId).name} an! (Bezweifelt: ${pending.claimedRole})`);
  } else {
    pending.challengeTarget = pending.blockPlayerId;
    addLog(state, `${challenger.name} zeigt ${getPlayerById(state, pending.blockPlayerId).name} an! (Bezweifelt Block: ${pending.blockClaimedRole})`);
  }

  state.reactionState = REACTION_STATES.AWAITING_BESTECHUNG;
}

function handleAcceptBestechung(state, pending) {
  const challenger = getPlayerById(state, pending.challengePlayerId);
  const target = getPlayerById(state, pending.challengeTarget);

  // Transfer bribe
  transferCoins(state, pending.challengeTarget, pending.challengePlayerId, pending.bestechungOffer);
  addLog(state, `${challenger.name} nimmt die Bestechung (${pending.bestechungOffer} Münzen) an. Anzeige zurückgezogen.`);

  // Anzeige dropped — what happens to the action?
  if (pending.blocked && pending.challengeTarget === pending.blockPlayerId) {
    // Was challenging a block, bribe accepted → block stands, action fails
    pending.actionSucceeds = false;
  } else {
    // Was challenging an action, bribe accepted → action proceeds
    pending.actionSucceeds = true;
  }

  state.reactionState = REACTION_STATES.RESOLVING;
}

function handleDeclineBestechung(state, pending) {
  addLog(state, `Bestechung abgelehnt. Karte wird aufgedeckt.`);
  handleRevealCard(state, pending);
}

function handleRevealCard(state, pending) {
  const targetId = pending.challengeTarget;
  const target = getPlayerById(state, targetId);
  const challenger = getPlayerById(state, pending.challengePlayerId);

  const claimedRole = pending.blocked && targetId === pending.blockPlayerId
    ? pending.blockClaimedRole
    : pending.claimedRole;

  // Does target actually have the claimed role?
  const hasRole = target.cards.some(c => !c.revealed && c.role === claimedRole);

  if (hasRole) {
    // Anzeige FALSCH — challenger loses card + extra coin
    addLog(state, `Anzeige FALSCH! ${target.name} hat tatsächlich ${claimedRole}.`);
    transferCoins(state, pending.challengePlayerId, 'pot', ANZEIGE_FAIL_EXTRA_COST);

    // Challenger loses a card (will be chosen by player/AI)
    pending._challengerMustLoseCard = true;

    // Target swaps the revealed card for a new one from deck
    const cardIdx = target.cards.findIndex(c => !c.revealed && c.role === claimedRole);
    if (cardIdx >= 0 && state.deck.length > 0) {
      const oldRole = target.cards[cardIdx].role;
      state.deck.push(oldRole);
      state.deck = shuffle(state.deck);
      target.cards[cardIdx].role = state.deck.pop();
      addLog(state, `${target.name} tauscht die aufgedeckte Karte gegen eine neue.`);
    }

    if (pending.blocked && targetId === pending.blockPlayerId) {
      // False challenge on block → block stands, action fails
      pending.actionSucceeds = false;
      // Doppelgefahr: if action was Auftrag, it still goes through
      if (pending.actionId === ACTIONS.AUFTRAG) {
        pending.doppelgefahr = true;
        pending.actionSucceeds = true;
        addLog(state, `Doppelgefahr! Falsche Anzeige gegen Polizist — Auftrag geht trotzdem durch.`);
      }
    } else {
      // False challenge on action → action proceeds
      pending.actionSucceeds = true;
    }
  } else {
    // Anzeige RICHTIG — target loses a card
    addLog(state, `Anzeige RICHTIG! ${target.name} hat ${claimedRole} nicht.`);

    pending._targetMustLoseCard = true;

    if (pending.blocked && targetId === pending.blockPlayerId) {
      // Correct challenge on block → block fails, action succeeds
      pending.actionSucceeds = true;
    } else {
      // Correct challenge on action → action fails
      pending.actionSucceeds = false;
    }
  }

  state.reactionState = REACTION_STATES.RESOLVING;
}

// Start reaction flow for an action
export function startReactionFlow(state, pending) {
  const info = ACTION_INFO[pending.actionId];

  // Bürgergeld is never challengeable or blockable
  if (pending.actionId === ACTIONS.BUERGERGELD) {
    state.reactionState = REACTION_STATES.RESOLVING;
    pending.actionSucceeds = true;
    return;
  }

  // Sturz has special bribery flow
  if (pending.actionId === ACTIONS.STURZ) {
    state.reactionState = REACTION_STATES.AWAITING_STURZ_BESTECHUNG;
    return;
  }

  // If action is challengeable or blockable, await reactions
  if (info.challengeable || info.blockable) {
    state.reactionState = REACTION_STATES.AWAITING_REACTIONS;
    return;
  }

  // Subvention: not challengeable but blockable
  if (info.blockable) {
    state.reactionState = REACTION_STATES.AWAITING_REACTIONS;
    return;
  }

  // Default: action succeeds immediately
  state.reactionState = REACTION_STATES.RESOLVING;
  pending.actionSucceeds = true;
}
