// ============================================================
// Das Ministerium — Headless Simulation (no DOM, no UI)
// ============================================================

// Inline all game logic for Node.js (no ES modules, no DOM)

const ROLES = { FINANZAMT: 'Finanzamt', POLITIKER: 'Politiker', DIEB: 'Dieb', GANGSTER: 'Gangster', POLIZIST: 'Polizist' };
const ROLE_LIST = Object.values(ROLES);
const CARDS_PER_ROLE = 3;
const START_COINS = 10;
const TOTAL_COINS = 50;
const ABGABE_COST = 2;
const STURZ_COST = 5;
const AUFTRAG_COST = 3;
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

const ACTION_INFO = {
  [ACTIONS.BUERGERGELD]: { name: 'Bürgergeld', requiresRole: null, requiresTarget: false, potMin: 1, coinCost: 0, challengeable: false, blockable: false },
  [ACTIONS.SUBVENTION]: { name: 'Subvention', requiresRole: null, requiresTarget: false, potMin: 2, coinCost: 0, challengeable: false, blockable: true },
  [ACTIONS.STEUERN]: { name: 'Steuern', requiresRole: ROLES.FINANZAMT, requiresTarget: false, potMin: 3, coinCost: 0, challengeable: true, blockable: false },
  [ACTIONS.KARTEN_TAUSCHEN]: { name: 'Karten tauschen', requiresRole: ROLES.POLITIKER, requiresTarget: false, potMin: 0, coinCost: 0, challengeable: true, blockable: false },
  [ACTIONS.STEHLEN]: { name: 'Stehlen', requiresRole: ROLES.DIEB, requiresTarget: true, potMin: 0, coinCost: 0, challengeable: true, blockable: true },
  [ACTIONS.AUFTRAG]: { name: 'Auftrag', requiresRole: ROLES.GANGSTER, requiresTarget: true, potMin: 0, coinCost: AUFTRAG_COST, coinTarget: 'bank', challengeable: true, blockable: true },
  [ACTIONS.STURZ]: { name: 'Sturz', requiresRole: null, requiresTarget: true, requiresRoleGuess: true, potMin: 0, coinCost: STURZ_COST, coinTarget: 'pot', challengeable: false, blockable: false, bribeable: true }
};

const BLOCK_MATRIX = {
  [ACTIONS.SUBVENTION]: { roles: [ROLES.FINANZAMT], anyoneCanBlock: true },
  [ACTIONS.STEHLEN]: { roles: [ROLES.DIEB, ROLES.POLITIKER], anyoneCanBlock: false },
  [ACTIONS.AUFTRAG]: { roles: [ROLES.POLIZIST], anyoneCanBlock: false }
};

const AI_PROFILES = {
  schwach: { anzeigeRate: 0.22, bluffRate: 0.28, blockRate: 0.28, auftragRate: 0.38, sturzRate: 0.30, bestechungAnbieten: 0.28, bestechungAnnehmen: 0.58, zieltAufSchwächsten: 0.45, sturzTrefferquote: 0.25 },
  mittel: { anzeigeRate: 0.40, bluffRate: 0.44, blockRate: 0.48, auftragRate: 0.58, sturzRate: 0.48, bestechungAnbieten: 0.48, bestechungAnnehmen: 0.44, zieltAufSchwächsten: 0.68, sturzTrefferquote: 0.42 },
  stark: { anzeigeRate: 0.56, bluffRate: 0.58, blockRate: 0.68, auftragRate: 0.72, sturzRate: 0.62, bestechungAnbieten: 0.62, bestechungAnnehmen: 0.36, zieltAufSchwächsten: 0.80, sturzTrefferquote: 0.56 }
};

function rand() { return Math.random(); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck() {
  const deck = [];
  for (const r of ROLE_LIST) for (let i = 0; i < CARDS_PER_ROLE; i++) deck.push(r);
  return shuffle(deck);
}

function getInfluence(p) { return p.cards.filter(c => !c.revealed).length; }
function hasRole(p, role) { return p.cards.some(c => !c.revealed && c.role === role); }

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

function getAlive(gs) { return gs.players.filter(p => !gs.metaEliminated.includes(p.id)); }
function getActive(gs) { return gs.players.filter(p => !gs.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) > 0); }

function getTargets(gs, player, actionId) {
  return gs.players.filter(p => {
    if (p.id === player.id) return false;
    if (p.eliminated || gs.metaEliminated.includes(p.id) || getInfluence(p) === 0) return false;
    if (actionId === ACTIONS.STEHLEN && p.coins < 1) return false;
    return true;
  });
}

function canDo(gs, player, actionId) {
  const info = ACTION_INFO[actionId];
  if (info.coinCost > 0 && player.coins < info.coinCost) return false;
  if (info.potMin > 0 && gs.pot < info.potMin) return false;
  if (info.requiresTarget && getTargets(gs, player, actionId).length === 0) return false;
  return true;
}

function getAvailable(gs, player) {
  return Object.keys(ACTION_INFO).filter(a => canDo(gs, player, a));
}

// Simple AI action choice
function aiAction(gs, player) {
  const profile = AI_PROFILES[player.aiProfile] || AI_PROFILES.mittel;
  const avail = getAvailable(gs, player);
  if (avail.length === 0) return null;

  const candidates = [];
  if (avail.includes(ACTIONS.BUERGERGELD)) candidates.push({ a: ACTIONS.BUERGERGELD, w: 1.0 });
  if (avail.includes(ACTIONS.SUBVENTION)) candidates.push({ a: ACTIONS.SUBVENTION, w: 0.5 });
  if (avail.includes(ACTIONS.STEUERN)) {
    if (hasRole(player, ROLES.FINANZAMT) || rand() < profile.bluffRate) candidates.push({ a: ACTIONS.STEUERN, w: 1.8 });
  }
  if (avail.includes(ACTIONS.KARTEN_TAUSCHEN)) {
    if (hasRole(player, ROLES.POLITIKER) || rand() < profile.bluffRate) candidates.push({ a: ACTIONS.KARTEN_TAUSCHEN, w: 0.8 });
  }
  if (avail.includes(ACTIONS.STEHLEN) && (hasRole(player, ROLES.DIEB) || rand() < profile.bluffRate))
    candidates.push({ a: ACTIONS.STEHLEN, w: 0.6 });
  if (avail.includes(ACTIONS.AUFTRAG) && rand() < profile.auftragRate && (hasRole(player, ROLES.GANGSTER) || rand() < profile.bluffRate))
    candidates.push({ a: ACTIONS.AUFTRAG, w: 1.8 });
  if (avail.includes(ACTIONS.STURZ) && rand() < profile.sturzRate)
    candidates.push({ a: ACTIONS.STURZ, w: 1.9 });

  if (candidates.length === 0) {
    const nonTargeted = avail.find(a => !ACTION_INFO[a].requiresTarget);
    return { actionId: nonTargeted || ACTIONS.KARTEN_TAUSCHEN };
  }

  const total = candidates.reduce((s, c) => s + c.w, 0);
  let r = rand() * total;
  let chosen = candidates[0];
  for (const c of candidates) { r -= c.w; if (r <= 0) { chosen = c; break; } }

  const result = { actionId: chosen.a };
  const info = ACTION_INFO[chosen.a];
  if (info.requiresTarget) {
    const targets = getTargets(gs, player, chosen.a);
    if (targets.length === 0) return { actionId: ACTIONS.KARTEN_TAUSCHEN };
    result.targetId = (rand() < profile.zieltAufSchwächsten)
      ? targets.sort((a, b) => a.coins - b.coins)[0].id
      : pick(targets).id;
  }
  if (chosen.a === ACTIONS.STURZ) result.roleGuess = pick(ROLE_LIST);
  return result;
}

function loseCard(gs, playerId) {
  const p = gs.players.find(x => x.id === playerId);
  if (!p) return;
  const idx = p.cards.findIndex(c => !c.revealed);
  if (idx >= 0) { p.cards[idx].revealed = true; gs.discardPile.push(p.cards[idx].role); }
}

// Simulate one full game, return stats
function simulateGame(playerCount, difficulty) {
  const deck = createDeck();
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: i, name: `P${i}`, coins: START_COINS,
      cards: [{ role: deck.pop(), revealed: false }, { role: deck.pop(), revealed: false }],
      isBot: true, aiProfile: difficulty, eliminated: false
    });
  }

  const gs = {
    players, bank: TOTAL_COINS - playerCount * START_COINS, pot: 0,
    deck, discardPile: [], metaEliminated: [], round: 1
  };

  const stats = {
    rounds: 0, totalActions: 0, actionCounts: {}, sturzCount: 0, sturzHits: 0,
    anzeigeCount: 0, blockCount: 0, avgPotAtRoundEnd: 0, potSums: 0,
    winnerCoins: 0, maxRoundReached: 0
  };

  const MAX_ROUNDS = 100;
  const MAX_ACTIONS_PER_ROUND = 200;

  while (true) {
    stats.rounds = gs.round;
    if (gs.round > MAX_ROUNDS) break;

    // Abgabe
    const alive = getAlive(gs);
    for (const p of alive) {
      if (p.coins > 0) transferCoins(gs, p.id, 'pot', ABGABE_COST);
    }
    for (const p of alive) {
      if (p.coins === 0 && !gs.metaEliminated.includes(p.id)) {
        p.eliminated = true;
        gs.metaEliminated.push(p.id);
      }
    }

    const remaining = getAlive(gs);
    if (remaining.length <= 1) { if (remaining[0]) stats.winnerCoins = remaining[0].coins; break; }

    // Deal cards (round 2+)
    if (gs.round > 1) {
      const allCards = [];
      for (const p of gs.players) { for (const c of p.cards) allCards.push(c.role); p.cards = []; }
      allCards.push(...gs.discardPile, ...gs.deck);
      gs.deck = shuffle(allCards); gs.discardPile = [];
      for (const p of remaining) {
        p.cards = [{ role: gs.deck.pop(), revealed: false }, { role: gs.deck.pop(), revealed: false }];
        p.eliminated = false;
      }
    }

    // Action phase
    let actionCount = 0;
    let activeList = getActive(gs);
    let currentIdx = 0;

    while (activeList.length > 1 && actionCount < MAX_ACTIONS_PER_ROUND) {
      const player = activeList[currentIdx % activeList.length];
      if (!player || player.eliminated || getInfluence(player) === 0) {
        activeList = getActive(gs);
        currentIdx++;
        continue;
      }

      const choice = aiAction(gs, player);
      if (!choice) { currentIdx++; continue; }

      actionCount++;
      stats.totalActions++;
      stats.actionCounts[choice.actionId] = (stats.actionCounts[choice.actionId] || 0) + 1;

      const info = ACTION_INFO[choice.actionId];

      // Pay costs
      if (info.coinCost > 0) {
        if (info.coinTarget === 'bank') transferCoins(gs, player.id, 'bank', info.coinCost);
        else if (info.coinTarget === 'pot') transferCoins(gs, player.id, 'pot', info.coinCost);
      }

      // Simple reaction simulation
      const claimedRole = info.requiresRole;
      let blocked = false;
      let actionSucceeds = true;

      // Challenge (Anzeige)
      if (info.challengeable && claimedRole) {
        for (const other of getActive(gs)) {
          if (other.id === player.id) continue;
          const prof = AI_PROFILES[other.aiProfile] || AI_PROFILES.mittel;
          if (other.coins >= ANZEIGE_COST && rand() < prof.anzeigeRate) {
            stats.anzeigeCount++;
            transferCoins(gs, other.id, 'pot', ANZEIGE_COST);
            if (hasRole(player, claimedRole)) {
              // False Anzeige — challenger loses card
              transferCoins(gs, other.id, 'pot', ANZEIGE_FAIL_EXTRA_COST);
              loseCard(gs, other.id);
              // Player swaps proven card
              const ci = player.cards.findIndex(c => !c.revealed && c.role === claimedRole);
              if (ci >= 0 && gs.deck.length > 0) {
                gs.deck.push(player.cards[ci].role);
                gs.deck = shuffle(gs.deck);
                player.cards[ci].role = gs.deck.pop();
              }
              actionSucceeds = true;
            } else {
              // Correct Anzeige — actor loses card
              loseCard(gs, player.id);
              actionSucceeds = false;
              // Refund Auftrag if Gangster claim was false
              if (choice.actionId === ACTIONS.AUFTRAG) {
                transferCoins(gs, 'bank', player.id, AUFTRAG_COST);
              }
            }
            break;
          }
        }
      }

      // Block
      if (actionSucceeds && info.blockable && !blocked) {
        const blockInfo = BLOCK_MATRIX[choice.actionId];
        if (blockInfo) {
          const blockers = blockInfo.anyoneCanBlock
            ? getActive(gs).filter(p => p.id !== player.id)
            : (choice.targetId ? [gs.players.find(p => p.id === choice.targetId)].filter(Boolean) : []);
          for (const blocker of blockers) {
            if (getInfluence(blocker) === 0) continue;
            const prof = AI_PROFILES[blocker.aiProfile] || AI_PROFILES.mittel;
            const canBlock = blockInfo.roles.some(r => hasRole(blocker, r));
            if (canBlock && rand() < prof.blockRate + 0.2) {
              blocked = true; actionSucceeds = false; stats.blockCount++;
              break;
            } else if (rand() < prof.blockRate * prof.bluffRate) {
              blocked = true; actionSucceeds = false; stats.blockCount++;
              break;
            }
          }
        }
      }

      // Sturz bribery
      if (choice.actionId === ACTIONS.STURZ && choice.targetId) {
        stats.sturzCount++;
        const target = gs.players.find(p => p.id === choice.targetId);
        if (target) {
          const prof = AI_PROFILES[target.aiProfile] || AI_PROFILES.mittel;
          if (target.coins >= MIN_BESTECHUNG_STURZ && rand() < prof.bestechungAnbieten) {
            const bribe = Math.max(MIN_BESTECHUNG_STURZ, Math.floor(target.coins * 0.3));
            const attackProf = AI_PROFILES[player.aiProfile] || AI_PROFILES.mittel;
            if (rand() < attackProf.bestechungAnnehmen) {
              transferCoins(gs, target.id, player.id, bribe);
              actionSucceeds = false;
            }
          }
        }
      }

      // Execute action
      if (actionSucceeds) {
        const target = choice.targetId ? gs.players.find(p => p.id === choice.targetId) : null;
        switch (choice.actionId) {
          case ACTIONS.BUERGERGELD: transferCoins(gs, 'pot', player.id, 1); break;
          case ACTIONS.SUBVENTION: transferCoins(gs, 'pot', player.id, 2); break;
          case ACTIONS.STEUERN: transferCoins(gs, 'pot', player.id, 3); break;
          case ACTIONS.STEHLEN: if (target) transferCoins(gs, target.id, player.id, Math.min(2, target.coins)); break;
          case ACTIONS.AUFTRAG: if (target) loseCard(gs, target.id); break;
          case ACTIONS.KARTEN_TAUSCHEN: {
            const unrevealed = player.cards.filter(c => !c.revealed);
            for (const c of unrevealed) { gs.deck.push(c.role); }
            gs.deck = shuffle(gs.deck);
            for (const c of unrevealed) { c.role = gs.deck.pop(); }
            break;
          }
          case ACTIONS.STURZ: {
            if (target && choice.roleGuess) {
              const match = target.cards.find(c => !c.revealed && c.role === choice.roleGuess);
              if (match) { match.revealed = true; gs.discardPile.push(match.role); stats.sturzHits++; }
            }
            break;
          }
        }
      }

      // Check round end
      for (const p of gs.players) {
        if (!gs.metaEliminated.includes(p.id) && !p.eliminated && getInfluence(p) === 0) {
          p.eliminated = true;
        }
      }

      activeList = getActive(gs);
      if (activeList.length <= 1) break;
      currentIdx++;
    }

    // Pot distribution
    const roundWinner = activeList[0];
    if (roundWinner) {
      const winAmount = Math.min(WINNER_CAP, gs.pot);
      transferCoins(gs, 'pot', roundWinner.id, winAmount);

      const othersAlive = getAlive(gs).filter(p => p.id !== roundWinner.id);
      if (othersAlive.length + 1 >= 3) {
        for (const p of othersAlive) {
          const r = Math.min(REDISTRIBUTION, gs.pot);
          if (r > 0) transferCoins(gs, 'pot', p.id, r);
        }
      }
    }

    stats.potSums += gs.pot;

    // Eliminate 0-coin players
    for (const p of gs.players) {
      if (p.coins === 0 && !gs.metaEliminated.includes(p.id)) {
        p.eliminated = true;
        gs.metaEliminated.push(p.id);
      }
    }

    const finalRemaining = getAlive(gs);
    if (finalRemaining.length <= 1) {
      if (finalRemaining[0]) stats.winnerCoins = finalRemaining[0].coins;
      break;
    }

    gs.round++;
  }

  stats.maxRoundReached = gs.round;
  stats.avgPotAtRoundEnd = stats.rounds > 0 ? stats.potSums / stats.rounds : 0;
  return stats;
}

// ---- RUN SIMULATIONS ----

function runSimulations(numGames, playerCount, difficulty) {
  const totals = {
    rounds: 0, totalActions: 0, actionCounts: {}, sturzCount: 0, sturzHits: 0,
    anzeigeCount: 0, blockCount: 0, avgPotAtRoundEnd: 0, winnerCoins: 0,
    maxRound: 0, minRound: Infinity
  };

  for (let i = 0; i < numGames; i++) {
    const s = simulateGame(playerCount, difficulty);
    totals.rounds += s.rounds;
    totals.totalActions += s.totalActions;
    totals.sturzCount += s.sturzCount;
    totals.sturzHits += s.sturzHits;
    totals.anzeigeCount += s.anzeigeCount;
    totals.blockCount += s.blockCount;
    totals.avgPotAtRoundEnd += s.avgPotAtRoundEnd;
    totals.winnerCoins += s.winnerCoins;
    totals.maxRound = Math.max(totals.maxRound, s.maxRoundReached);
    totals.minRound = Math.min(totals.minRound, s.rounds);
    for (const [k, v] of Object.entries(s.actionCounts)) {
      totals.actionCounts[k] = (totals.actionCounts[k] || 0) + v;
    }
  }

  const n = numGames;
  return {
    games: n,
    playerCount,
    difficulty,
    avgRounds: (totals.rounds / n).toFixed(1),
    minRounds: totals.minRound,
    maxRounds: totals.maxRound,
    avgActions: (totals.totalActions / n).toFixed(1),
    avgWinnerCoins: (totals.winnerCoins / n).toFixed(1),
    avgPotLeftover: (totals.avgPotAtRoundEnd / n).toFixed(1),
    avgSturz: (totals.sturzCount / n).toFixed(2),
    sturzHitRate: totals.sturzCount > 0 ? ((totals.sturzHits / totals.sturzCount) * 100).toFixed(1) + '%' : 'N/A',
    avgAnzeige: (totals.anzeigeCount / n).toFixed(2),
    avgBlocks: (totals.blockCount / n).toFixed(2),
    actionBreakdown: Object.fromEntries(
      Object.entries(totals.actionCounts).map(([k, v]) => [k, (v / n).toFixed(1)])
    )
  };
}

// Run simulations
console.log('=== Das Ministerium — Balancing Simulation ===');
console.log(`Abgabe: ${ABGABE_COST}, Sturz: ${STURZ_COST}, Start: ${START_COINS}\n`);

const configs = [
  { players: 2, diff: 'mittel', games: 500 },
  { players: 3, diff: 'mittel', games: 500 },
  { players: 4, diff: 'mittel', games: 500 },
  { players: 4, diff: 'schwach', games: 500 },
  { players: 4, diff: 'stark', games: 500 },
  { players: 5, diff: 'mittel', games: 500 },
  { players: 6, diff: 'mittel', games: 300 },
];

for (const cfg of configs) {
  const result = runSimulations(cfg.games, cfg.players, cfg.diff);
  console.log(`--- ${cfg.players} Spieler | ${cfg.diff} | ${cfg.games} Spiele ---`);
  console.log(`  Runden:        Ø ${result.avgRounds} (${result.minRounds}–${result.maxRounds})`);
  console.log(`  Aktionen/Spiel: Ø ${result.avgActions}`);
  console.log(`  Gewinner-Münzen: Ø ${result.avgWinnerCoins}`);
  console.log(`  Pot-Rest (Ø):  ${result.avgPotLeftover}`);
  console.log(`  Sturz/Spiel:   Ø ${result.avgSturz} (Trefferquote: ${result.sturzHitRate})`);
  console.log(`  Anzeigen/Spiel: Ø ${result.avgAnzeige}`);
  console.log(`  Blocks/Spiel:  Ø ${result.avgBlocks}`);
  console.log(`  Aktionen:      ${JSON.stringify(result.actionBreakdown)}`);
  console.log();
}
