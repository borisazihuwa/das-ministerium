// ============================================================
// Das Ministerium — AI Bot Decision Making
// ============================================================

import {
  ACTIONS, ACTION_INFO, BLOCK_MATRIX, AI_PROFILES, ROLES, ROLE_LIST,
  MIN_BESTECHUNG_ANZEIGE, MIN_BESTECHUNG_STURZ, AUFTRAG_COST, STURZ_COST
} from './constants.js';
import { getAvailableActions, getValidTargets } from './actions.js';
import { getAvailableReactions } from './reactions.js';
import { getInfluence, getPlayerById } from './gameState.js';

function rand() { return Math.random(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getProfile(player) {
  return AI_PROFILES[player.aiProfile] || AI_PROFILES.mittel;
}

function getUnrevealedRoles(player) {
  return player.cards.filter(c => !c.revealed).map(c => c.role);
}

function hasRole(player, role) {
  return player.cards.some(c => !c.revealed && c.role === role);
}

// Find the weakest opponent (fewest coins, then fewest influence)
function findWeakest(state, excludeId) {
  const opponents = state.players.filter(p =>
    p.id !== excludeId && !p.eliminated && !state.metaEliminated.includes(p.id) && getInfluence(p) > 0
  );
  if (opponents.length === 0) return null;
  return opponents.sort((a, b) => {
    if (a.coins !== b.coins) return a.coins - b.coins;
    return getInfluence(a) - getInfluence(b);
  })[0];
}

function findStrongest(state, excludeId) {
  const opponents = state.players.filter(p =>
    p.id !== excludeId && !p.eliminated && !state.metaEliminated.includes(p.id) && getInfluence(p) > 0
  );
  if (opponents.length === 0) return null;
  return opponents.sort((a, b) => {
    if (b.coins !== a.coins) return b.coins - a.coins;
    return getInfluence(b) - getInfluence(a);
  })[0];
}

// Choose a target based on profile
function chooseTarget(state, player, actionId) {
  const profile = getProfile(player);
  const targets = getValidTargets(state, player, actionId);
  if (targets.length === 0) return null;

  if (rand() < profile.zieltAufSchwächsten) {
    const weakest = findWeakest(state, player.id);
    if (weakest && targets.find(t => t.id === weakest.id)) return weakest.id;
  }

  return pick(targets).id;
}

// AI chooses an action
export function aiChooseAction(state, player) {
  const profile = getProfile(player);
  const available = getAvailableActions(state, player);
  const roles = getUnrevealedRoles(player);

  if (available.length === 0) return null;

  // Build weighted action candidates
  const candidates = [];

  // Always consider income actions
  if (available.includes(ACTIONS.BUERGERGELD)) {
    candidates.push({ action: ACTIONS.BUERGERGELD, weight: 1 });
  }
  if (available.includes(ACTIONS.SUBVENTION)) {
    candidates.push({ action: ACTIONS.SUBVENTION, weight: 2 });
  }

  // Steuern — if we have Finanzamt or willing to bluff
  if (available.includes(ACTIONS.STEUERN)) {
    if (hasRole(player, ROLES.FINANZAMT)) {
      candidates.push({ action: ACTIONS.STEUERN, weight: 4 });
    } else if (rand() < profile.bluffRate) {
      candidates.push({ action: ACTIONS.STEUERN, weight: 2 });
    }
  }

  // Karten tauschen — if we have Politiker or willing to bluff
  if (available.includes(ACTIONS.KARTEN_TAUSCHEN)) {
    if (hasRole(player, ROLES.POLITIKER)) {
      candidates.push({ action: ACTIONS.KARTEN_TAUSCHEN, weight: 3 });
    } else if (rand() < profile.bluffRate) {
      candidates.push({ action: ACTIONS.KARTEN_TAUSCHEN, weight: 1.5 });
    }
  }

  // Stehlen — if we have Dieb or willing to bluff
  if (available.includes(ACTIONS.STEHLEN)) {
    if (hasRole(player, ROLES.DIEB)) {
      candidates.push({ action: ACTIONS.STEHLEN, weight: 3.5 });
    } else if (rand() < profile.bluffRate) {
      candidates.push({ action: ACTIONS.STEHLEN, weight: 2 });
    }
  }

  // Auftrag — aggressive action
  if (available.includes(ACTIONS.AUFTRAG) && rand() < profile.auftragRate) {
    if (hasRole(player, ROLES.GANGSTER)) {
      candidates.push({ action: ACTIONS.AUFTRAG, weight: 4 });
    } else if (rand() < profile.bluffRate) {
      candidates.push({ action: ACTIONS.AUFTRAG, weight: 2.5 });
    }
  }

  // Sturz — risky but powerful
  if (available.includes(ACTIONS.STURZ) && rand() < profile.sturzRate) {
    candidates.push({ action: ACTIONS.STURZ, weight: 2 });
  }

  // Fallback to Bürgergeld
  if (candidates.length === 0) {
    if (available.includes(ACTIONS.BUERGERGELD)) return { actionId: ACTIONS.BUERGERGELD };
    return { actionId: available[0] };
  }

  // Weighted random selection
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let r = rand() * totalWeight;
  let chosen = candidates[0];
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) { chosen = c; break; }
  }

  const result = { actionId: chosen.action };

  // Choose target if needed
  const info = ACTION_INFO[chosen.action];
  if (info.requiresTarget) {
    result.targetId = chooseTarget(state, player, chosen.action);
    if (!result.targetId) {
      // Fallback to non-targeted action
      if (available.includes(ACTIONS.BUERGERGELD)) return { actionId: ACTIONS.BUERGERGELD };
      return { actionId: available.find(a => !ACTION_INFO[a].requiresTarget) || available[0] };
    }
  }

  // Role guess for Sturz
  if (chosen.action === ACTIONS.STURZ && result.targetId) {
    result.roleGuess = aiGuessRole(state, player, result.targetId);
  }

  return result;
}

// AI guesses a role for Sturz
function aiGuessRole(state, player, targetId) {
  const profile = getProfile(player);
  const target = getPlayerById(state, targetId);

  // Track revealed cards to narrow down possibilities
  const revealedCounts = {};
  for (const role of ROLE_LIST) revealedCounts[role] = 0;

  for (const p of state.players) {
    for (const c of p.cards) {
      if (c.revealed) revealedCounts[c.role]++;
    }
  }
  for (const role of state.discardPile || []) {
    revealedCounts[role]++;
  }

  // Roles that still have unrevealed copies
  const possibleRoles = ROLE_LIST.filter(r => revealedCounts[r] < 3);

  if (possibleRoles.length === 0) return pick(ROLE_LIST);

  // Slightly smarter: guess roles that haven't been seen much
  if (rand() < profile.sturzTrefferquote) {
    // "Smart" guess — weighted toward less-revealed roles
    return pick(possibleRoles);
  }
  return pick(ROLE_LIST);
}

// AI decides on a reaction
export function aiChooseReaction(state, pending, player) {
  const profile = getProfile(player);
  const reactions = getAvailableReactions(state, pending, player.id);

  if (reactions.length === 0) return null;
  if (reactions.length === 1) return { reaction: reactions[0] };

  // Anzeige decision
  if (reactions.includes('anzeige')) {
    if (rand() < profile.anzeigeRate) {
      return { reaction: 'anzeige' };
    }
  }

  // Block decision
  if (reactions.includes('block')) {
    const blockInfo = BLOCK_MATRIX[pending.actionId];
    if (blockInfo) {
      const myRoles = getUnrevealedRoles(player);
      const canTrulyBlock = blockInfo.roles.some(r => myRoles.includes(r));

      if (canTrulyBlock) {
        if (rand() < profile.blockRate + 0.2) { // Higher chance if actually have the role
          return { reaction: 'block', params: { blockRole: blockInfo.roles.find(r => myRoles.includes(r)) } };
        }
      } else if (rand() < profile.blockRate * profile.bluffRate) {
        // Bluff block
        return { reaction: 'block', params: { blockRole: pick(blockInfo.roles) } };
      }
    }
  }

  // Challenge on block
  if (reactions.includes('anzeige_block')) {
    if (rand() < profile.anzeigeRate) {
      return { reaction: 'anzeige_block' };
    }
    return { reaction: 'accept_block' };
  }

  // Bestechung decisions
  if (reactions.includes('bestechung')) {
    if (rand() < profile.bestechungAnbieten) {
      let amount = MIN_BESTECHUNG_ANZEIGE;
      // Determine bribe amount
      const roles = getUnrevealedRoles(player);
      const claimedRole = pending.challengeTarget === pending.blockPlayerId
        ? pending.blockClaimedRole
        : pending.claimedRole;
      const hasIt = roles.includes(claimedRole);

      if (!hasIt && rand() < profile.bestechungBluffHoch) {
        // High bribe bluff — pretend we have it
        amount = Math.min(player.coins, Math.max(3, Math.floor(player.coins * 0.4)));
      } else if (hasIt && rand() < profile.bestechungBluffNiedrig) {
        // Low bribe with real card — try to seem weak
        amount = MIN_BESTECHUNG_ANZEIGE;
      } else if (hasIt) {
        amount = Math.min(player.coins, Math.max(MIN_BESTECHUNG_ANZEIGE, Math.floor(player.coins * 0.25)));
      } else {
        amount = Math.min(player.coins, MIN_BESTECHUNG_ANZEIGE);
      }

      return { reaction: 'bestechung', params: { amount } };
    }
    return { reaction: 'reveal_card' };
  }

  // Accept/decline bestechung
  if (reactions.includes('accept_bestechung')) {
    if (rand() < profile.bestechungAnnehmen) {
      return { reaction: 'accept_bestechung' };
    }
    return { reaction: 'decline_bestechung' };
  }

  // Sturz bestechung
  if (reactions.includes('sturz_bestechung')) {
    if (rand() < profile.bestechungAnbieten) {
      const amount = Math.min(player.coins, Math.max(MIN_BESTECHUNG_STURZ, Math.floor(player.coins * 0.3)));
      return { reaction: 'sturz_bestechung', params: { amount } };
    }
    return { reaction: 'accept_sturz' };
  }

  if (reactions.includes('accept_sturz_bestechung')) {
    if (rand() < profile.bestechungAnnehmen) {
      return { reaction: 'accept_sturz_bestechung' };
    }
    return { reaction: 'decline_sturz_bestechung' };
  }

  // Default: pass
  if (reactions.includes('pass')) return { reaction: 'pass' };
  return { reaction: reactions[0] };
}

// AI chooses which card to lose
export function aiChooseCardToLose(player) {
  const unrevealed = player.cards
    .map((c, i) => ({ ...c, index: i }))
    .filter(c => !c.revealed);

  if (unrevealed.length <= 1) return unrevealed[0]?.index ?? 0;

  // Prefer losing less useful roles
  const rolePriority = {
    [ROLES.POLIZIST]: 1, // Defensive only
    [ROLES.FINANZAMT]: 2,
    [ROLES.POLITIKER]: 3,
    [ROLES.DIEB]: 4,
    [ROLES.GANGSTER]: 5 // Most valuable (offensive)
  };

  unrevealed.sort((a, b) => (rolePriority[a.role] || 0) - (rolePriority[b.role] || 0));
  return unrevealed[0].index;
}

// AI chooses cards for Politiker swap (from 4 cards, keep 2)
export function aiChoosePolitikerCards(player, currentRoles, drawnRoles) {
  const allCards = [
    ...currentRoles.map((role, i) => ({ role, source: 'hand', index: i })),
    ...drawnRoles.map((role, i) => ({ role, source: 'drawn', index: i }))
  ];

  // Rank roles by usefulness
  const rolePriority = {
    [ROLES.GANGSTER]: 5,
    [ROLES.DIEB]: 4,
    [ROLES.POLITIKER]: 3,
    [ROLES.FINANZAMT]: 2,
    [ROLES.POLIZIST]: 1
  };

  // Pick best 2
  allCards.sort((a, b) => (rolePriority[b.role] || 0) - (rolePriority[a.role] || 0));
  const kept = allCards.slice(0, 2).map(c => c.role);
  const returned = allCards.slice(2).map(c => c.role);

  return { kept, returned };
}

// AI delay (milliseconds) to feel natural
export function getAiDelay() {
  return 600 + Math.random() * 900;
}
