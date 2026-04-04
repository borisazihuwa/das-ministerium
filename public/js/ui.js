// ============================================================
// Das Ministerium — UI Rendering
// ============================================================

import {
  ACTIONS, ACTION_INFO, BLOCK_MATRIX, ROLES, ROLE_LIST,
  MIN_BESTECHUNG_ANZEIGE, MIN_BESTECHUNG_STURZ, REACTION_STATES
} from './constants.js';
import { getInfluence, getPlayerById } from './gameState.js';
import { getAvailableActions, getValidTargets } from './actions.js';
import { getAvailableReactions } from './reactions.js';
import { renderLog } from './logger.js';

let gameRef = null;
let callbackRef = null;

export function initUI(game, callbacks) {
  gameRef = game;
  callbackRef = callbacks;
}

// ---- MENU SCREEN ----

export function showMenu() {
  document.getElementById('menu-screen').classList.remove('hidden');
  document.getElementById('game-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
}

export function hideMenu() {
  document.getElementById('menu-screen').classList.add('hidden');
}

export function showGameScreen() {
  document.getElementById('game-screen').classList.remove('hidden');
}

// ---- GAME RENDERING ----

export function renderGameState(state) {
  renderPlayers(state);
  renderEconomy(state);
  renderLog(state.log);
  renderPhaseInfo(state);
}

function renderPlayers(state) {
  const container = document.getElementById('players-area');
  container.innerHTML = '';

  for (const player of state.players) {
    const div = document.createElement('div');
    div.className = 'player-card';
    if (player.eliminated || state.metaEliminated.includes(player.id)) {
      div.classList.add('eliminated');
    }
    if (state.currentPlayerIndex !== undefined &&
        state.players[state.currentPlayerIndex]?.id === player.id) {
      div.classList.add('active-turn');
    }
    if (player.isHuman) {
      div.classList.add('human');
    }

    const nameDiv = document.createElement('div');
    nameDiv.className = 'player-name';
    nameDiv.textContent = player.name + (player.isBot ? ` (${player.aiProfile})` : ' (Du)');
    div.appendChild(nameDiv);

    const coinsDiv = document.createElement('div');
    coinsDiv.className = 'player-coins';
    coinsDiv.textContent = `${player.coins} Münzen`;
    div.appendChild(coinsDiv);

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'player-cards-display';

    for (const card of player.cards) {
      const cardEl = document.createElement('div');
      cardEl.className = 'card-mini';
      if (card.revealed) {
        cardEl.classList.add('revealed');
        cardEl.textContent = card.role;
      } else if (player.isHuman) {
        cardEl.classList.add('own-card');
        cardEl.textContent = card.role;
      } else {
        cardEl.classList.add('hidden-card');
        cardEl.textContent = '?';
      }
      cardsDiv.appendChild(cardEl);
    }

    div.appendChild(cardsDiv);

    if (getInfluence(player) > 0 && !state.metaEliminated.includes(player.id)) {
      const influenceDiv = document.createElement('div');
      influenceDiv.className = 'player-influence';
      influenceDiv.textContent = `Einfluss: ${getInfluence(player)}`;
      div.appendChild(influenceDiv);
    }

    container.appendChild(div);
  }
}

function renderEconomy(state) {
  document.getElementById('pot-display').textContent = `Pot: ${state.pot}`;
  document.getElementById('bank-display').textContent = `Bank: ${state.bank}`;
  document.getElementById('round-display').textContent = `Runde: ${state.round}`;
}

function renderPhaseInfo(state) {
  const phaseEl = document.getElementById('phase-info');
  const phases = {
    'round_setup': 'Runde wird vorbereitet...',
    'abgabe': 'Phase 1 — Abgabe',
    'actions': 'Phase 2 — Aktionen',
    'pot_distribution': 'Phase 3 — Pot-Verteilung',
    'game_over': 'Spiel beendet'
  };
  phaseEl.textContent = phases[state.phase] || state.phase;
}

// ---- ACTION SELECTION (Human Player) ----

export function showActionSelection(state, player) {
  return new Promise((resolve) => {
    const panel = document.getElementById('action-panel');
    panel.innerHTML = '';
    panel.classList.remove('hidden');

    const title = document.createElement('h3');
    title.textContent = 'Wähle eine Aktion:';
    panel.appendChild(title);

    const available = getAvailableActions(state, player);

    for (const actionId of available) {
      const info = ACTION_INFO[actionId];
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.innerHTML = `<strong>${info.name}</strong><br><small>${info.description}</small>`;

      btn.onclick = async () => {
        let targetId = null;
        let roleGuess = null;

        if (info.requiresTarget) {
          targetId = await showTargetSelection(state, player, actionId);
          if (targetId === null) return; // cancelled
        }

        if (info.requiresRoleGuess) {
          roleGuess = await showRoleGuessSelection();
          if (roleGuess === null) return; // cancelled
        }

        panel.classList.add('hidden');
        resolve({ actionId, targetId, roleGuess });
      };

      panel.appendChild(btn);
    }
  });
}

function showTargetSelection(state, player, actionId) {
  return new Promise((resolve) => {
    const targets = getValidTargets(state, player, actionId);
    const modal = showModal('Wähle ein Ziel:');

    for (const target of targets) {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = `${target.name} (${target.coins} Münzen, ${getInfluence(target)} Einfluss)`;
      btn.onclick = () => { closeModal(modal); resolve(target.id); };
      modal.querySelector('.modal-content').appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn cancel-btn';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.onclick = () => { closeModal(modal); resolve(null); };
    modal.querySelector('.modal-content').appendChild(cancelBtn);
  });
}

function showRoleGuessSelection() {
  return new Promise((resolve) => {
    const modal = showModal('Welche Rolle vermutest du?');

    for (const role of ROLE_LIST) {
      const btn = document.createElement('button');
      btn.className = 'action-btn role-btn';
      btn.textContent = role;
      btn.onclick = () => { closeModal(modal); resolve(role); };
      modal.querySelector('.modal-content').appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn cancel-btn';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.onclick = () => { closeModal(modal); resolve(null); };
    modal.querySelector('.modal-content').appendChild(cancelBtn);
  });
}

// ---- REACTION SELECTION (Human Player) ----

export function showReactionSelection(state, pending, player) {
  return new Promise((resolve) => {
    const reactions = getAvailableReactions(state, pending, player.id);
    if (reactions.length === 0) { resolve(null); return; }

    const panel = document.getElementById('action-panel');
    panel.innerHTML = '';
    panel.classList.remove('hidden');

    const title = document.createElement('h3');

    if (state.reactionState === REACTION_STATES.AWAITING_REACTIONS) {
      const actor = getPlayerById(state, pending.playerId);
      const info = ACTION_INFO[pending.actionId];
      title.textContent = `${actor.name} spielt: ${info.name}. Deine Reaktion?`;
    } else if (state.reactionState === REACTION_STATES.AWAITING_ANZEIGE_ON_BLOCK) {
      const blocker = getPlayerById(state, pending.blockPlayerId);
      title.textContent = `${blocker.name} blockiert mit ${pending.blockClaimedRole}. Anzeigen?`;
    } else if (state.reactionState === REACTION_STATES.AWAITING_BESTECHUNG) {
      title.textContent = 'Du wurdest angezeigt! Bestechung anbieten oder Karte aufdecken?';
    } else if (state.reactionState === REACTION_STATES.AWAITING_BESTECHUNG_DECISION) {
      title.textContent = `Bestechungsangebot: ${pending.bestechungOffer} Münzen. Annehmen?`;
    } else if (state.reactionState === REACTION_STATES.AWAITING_STURZ_BESTECHUNG) {
      title.textContent = 'Sturz gegen dich! Bestechung anbieten?';
    } else if (state.reactionState === REACTION_STATES.AWAITING_STURZ_BESTECHUNG_DECISION) {
      title.textContent = `Bestechung gegen Sturz: ${pending.bestechungOffer} Münzen. Annehmen?`;
    }

    panel.appendChild(title);

    const reactionLabels = {
      'anzeige': 'Anzeige! (1 Münze)',
      'block': 'Blockieren',
      'pass': 'Passen',
      'anzeige_block': 'Block anzweifeln! (1 Münze)',
      'accept_block': 'Block akzeptieren',
      'bestechung': 'Bestechung anbieten',
      'reveal_card': 'Karte aufdecken',
      'accept_bestechung': 'Bestechung annehmen',
      'decline_bestechung': 'Bestechung ablehnen',
      'sturz_bestechung': 'Bestechung anbieten',
      'accept_sturz': 'Sturz akzeptieren',
      'accept_sturz_bestechung': 'Bestechung annehmen',
      'decline_sturz_bestechung': 'Bestechung ablehnen'
    };

    for (const reaction of reactions) {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      if (reaction === 'pass' || reaction === 'accept_block' || reaction === 'accept_sturz') {
        btn.classList.add('passive-btn');
      }
      if (reaction === 'anzeige' || reaction === 'anzeige_block') {
        btn.classList.add('danger-btn');
      }

      btn.textContent = reactionLabels[reaction] || reaction;

      btn.onclick = async () => {
        let params = {};

        if (reaction === 'block') {
          const blockInfo = BLOCK_MATRIX[pending.actionId];
          if (blockInfo && blockInfo.roles.length > 1) {
            const role = await showBlockRoleSelection(blockInfo.roles);
            if (!role) return;
            params.blockRole = role;
          } else if (blockInfo) {
            params.blockRole = blockInfo.roles[0];
          }
        }

        if (reaction === 'bestechung') {
          const amount = await showBribeAmountSelection(player, MIN_BESTECHUNG_ANZEIGE);
          if (amount === null) return;
          params.amount = amount;
        }

        if (reaction === 'sturz_bestechung') {
          const amount = await showBribeAmountSelection(player, MIN_BESTECHUNG_STURZ);
          if (amount === null) return;
          params.amount = amount;
        }

        panel.classList.add('hidden');
        resolve({ reaction, params });
      };

      panel.appendChild(btn);
    }
  });
}

function showBlockRoleSelection(roles) {
  return new Promise((resolve) => {
    const modal = showModal('Mit welcher Rolle blockieren?');
    for (const role of roles) {
      const btn = document.createElement('button');
      btn.className = 'action-btn role-btn';
      btn.textContent = role;
      btn.onclick = () => { closeModal(modal); resolve(role); };
      modal.querySelector('.modal-content').appendChild(btn);
    }
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn cancel-btn';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.onclick = () => { closeModal(modal); resolve(null); };
    modal.querySelector('.modal-content').appendChild(cancelBtn);
  });
}

function showBribeAmountSelection(player, min) {
  return new Promise((resolve) => {
    const modal = showModal(`Bestechung: Wie viele Münzen? (Min: ${min}, Max: ${player.coins})`);
    const content = modal.querySelector('.modal-content');

    const amounts = [];
    for (let i = min; i <= player.coins; i++) {
      amounts.push(i);
    }

    // Show buttons for reasonable amounts
    const displayAmounts = amounts.length <= 6 ? amounts : [
      min, Math.floor(player.coins * 0.25), Math.floor(player.coins * 0.5), player.coins
    ].filter((v, i, a) => v >= min && a.indexOf(v) === i).sort((a, b) => a - b);

    for (const amount of displayAmounts) {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = `${amount} Münzen`;
      btn.onclick = () => { closeModal(modal); resolve(amount); };
      content.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn cancel-btn';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.onclick = () => { closeModal(modal); resolve(null); };
    content.appendChild(cancelBtn);
  });
}

// ---- CARD SELECTION ----

export function showCardSelection(player, message = 'Welche Karte verlieren?') {
  return new Promise((resolve) => {
    const unrevealed = player.cards
      .map((c, i) => ({ ...c, index: i }))
      .filter(c => !c.revealed);

    if (unrevealed.length <= 1) {
      resolve(unrevealed[0]?.index ?? 0);
      return;
    }

    const modal = showModal(message);
    for (const card of unrevealed) {
      const btn = document.createElement('button');
      btn.className = 'action-btn role-btn';
      btn.textContent = card.role;
      btn.onclick = () => { closeModal(modal); resolve(card.index); };
      modal.querySelector('.modal-content').appendChild(btn);
    }
  });
}

// Politiker swap: show all 4 cards, pick 2 to keep
export function showPolitikerSwap(player, drawnRoles) {
  return new Promise((resolve) => {
    const modal = showModal('Karten tauschen (Politiker): Wähle 2 Karten zum Behalten');
    const content = modal.querySelector('.modal-content');

    const currentRoles = player.cards.filter(c => !c.revealed).map(c => c.role);
    const allCards = [
      ...currentRoles.map(r => ({ role: r, source: 'hand' })),
      ...drawnRoles.map(r => ({ role: r, source: 'drawn' }))
    ];

    const selected = new Set();
    const buttons = [];

    const updateButtons = () => {
      buttons.forEach((btn, i) => {
        btn.classList.toggle('selected', selected.has(i));
      });
      confirmBtn.disabled = selected.size !== 2;
    };

    for (let i = 0; i < allCards.length; i++) {
      const card = allCards[i];
      const btn = document.createElement('button');
      btn.className = 'action-btn role-btn';
      btn.textContent = `${card.role} (${card.source === 'hand' ? 'Hand' : 'Neu'})`;
      btn.onclick = () => {
        if (selected.has(i)) {
          selected.delete(i);
        } else if (selected.size < 2) {
          selected.add(i);
        }
        updateButtons();
      };
      buttons.push(btn);
      content.appendChild(btn);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'action-btn confirm-btn';
    confirmBtn.textContent = 'Bestätigen';
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => {
      const kept = [];
      const returned = [];
      allCards.forEach((card, i) => {
        if (selected.has(i)) kept.push(card.role);
        else returned.push(card.role);
      });
      closeModal(modal);
      resolve({ kept, returned });
    };
    content.appendChild(confirmBtn);
  });
}

// ---- NOTIFICATION ----

export function showNotification(text, duration = 2000) {
  const notif = document.getElementById('notification');
  notif.textContent = text;
  notif.classList.remove('hidden');
  notif.classList.add('show');
  setTimeout(() => {
    notif.classList.remove('show');
    notif.classList.add('hidden');
  }, duration);
}

// ---- GAME OVER ----

export function showGameOver(winner) {
  document.getElementById('game-screen').classList.add('hidden');
  const screen = document.getElementById('game-over-screen');
  screen.classList.remove('hidden');
  document.getElementById('winner-name').textContent = winner ? winner.name : 'Niemand';
  document.getElementById('winner-coins').textContent = winner ? `${winner.coins} Münzen` : '';
}

// ---- MODAL SYSTEM ----

function showModal(title) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  modal.appendChild(titleEl);

  const content = document.createElement('div');
  content.className = 'modal-content';
  modal.appendChild(content);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return overlay;
}

function closeModal(overlay) {
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
}

export function hideActionPanel() {
  document.getElementById('action-panel').classList.add('hidden');
}
