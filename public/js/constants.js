// ============================================================
// Das Ministerium — Constants & Game Rules
// ============================================================

export const ROLES = {
  FINANZAMT: 'Finanzamt',
  POLITIKER: 'Politiker',
  DIEB: 'Dieb',
  GANGSTER: 'Gangster',
  POLIZIST: 'Polizist'
};

export const ROLE_LIST = Object.values(ROLES);

// 15 cards total: 3 of each role
export const CARDS_PER_ROLE = 3;
export const TOTAL_CARDS = ROLE_LIST.length * CARDS_PER_ROLE; // 15

// Economy
export const START_COINS = 10;
export const TOTAL_COINS = 50;
export const ABGABE_COST = 2;
export const STURZ_COST = 5;
export const AUFTRAG_COST = 3;
export const ANZEIGE_COST = 1;
export const ANZEIGE_FAIL_EXTRA_COST = 1; // additional 1 coin on failed Anzeige
export const MIN_BESTECHUNG_ANZEIGE = 2;
export const MIN_BESTECHUNG_STURZ = 1;
export const WINNER_CAP = 10;
export const REDISTRIBUTION = 1;

// Actions
export const ACTIONS = {
  BUERGERGELD: 'buergergeld',
  SUBVENTION: 'subvention',
  STEUERN: 'steuern',
  KARTEN_TAUSCHEN: 'karten_tauschen',
  STEHLEN: 'stehlen',
  AUFTRAG: 'auftrag',
  STURZ: 'sturz'
};

export const ACTION_INFO = {
  [ACTIONS.BUERGERGELD]: {
    name: 'Bürgergeld',
    description: '+1 Münze aus dem Pot',
    requiresRole: null,
    requiresTarget: false,

    potMin: 1,
    coinCost: 0,
    challengeable: false,
    blockable: false
  },
  [ACTIONS.SUBVENTION]: {
    name: 'Subvention',
    description: '+2 Münzen aus dem Pot',
    requiresRole: null,
    requiresTarget: false,

    potMin: 2,
    coinCost: 0,
    challengeable: false,
    blockable: true,
    blockedBy: [ROLES.FINANZAMT],
    anyoneCanBlock: true
  },
  [ACTIONS.STEUERN]: {
    name: 'Steuern eintreiben',
    description: '+3 Münzen aus dem Pot (Finanzamt)',
    requiresRole: ROLES.FINANZAMT,
    requiresTarget: false,

    potMin: 3,
    coinCost: 0,
    challengeable: true,
    blockable: false
  },
  [ACTIONS.KARTEN_TAUSCHEN]: {
    name: 'Karten tauschen',
    description: 'Karten ziehen und beste behalten (Politiker)',
    requiresRole: ROLES.POLITIKER,
    requiresTarget: false,

    potMin: 0,
    coinCost: 0,
    challengeable: true,
    blockable: false
  },
  [ACTIONS.STEHLEN]: {
    name: 'Stehlen',
    description: '2 Münzen von einem Spieler (Dieb)',
    requiresRole: ROLES.DIEB,
    requiresTarget: true,

    potMin: 0,
    coinCost: 0,
    challengeable: true,
    blockable: true,
    blockedBy: [ROLES.DIEB, ROLES.POLITIKER],
    anyoneCanBlock: false // only target
  },
  [ACTIONS.AUFTRAG]: {
    name: 'Auftrag erteilen',
    description: 'Ziel verliert 1 Karte, kostet 3 Münzen (Gangster)',
    requiresRole: ROLES.GANGSTER,
    requiresTarget: true,

    potMin: 0,
    coinCost: AUFTRAG_COST,
    coinTarget: 'bank',
    challengeable: true,
    blockable: true,
    blockedBy: [ROLES.POLIZIST],
    anyoneCanBlock: false // only target
  },
  [ACTIONS.STURZ]: {
    name: 'Sturz',
    description: 'Rolle einer Karte des Ziels erraten (7 Münzen)',
    requiresRole: null,
    requiresTarget: true,
    requiresRoleGuess: true,

    potMin: 0,
    coinCost: STURZ_COST,
    coinTarget: 'pot',
    challengeable: false,
    blockable: false,
    bribeable: true
  }
};

// Block matrix: which roles can block which actions
export const BLOCK_MATRIX = {
  [ACTIONS.SUBVENTION]: { roles: [ROLES.FINANZAMT], anyoneCanBlock: true },
  [ACTIONS.STEHLEN]: { roles: [ROLES.DIEB, ROLES.POLITIKER], anyoneCanBlock: false },
  [ACTIONS.AUFTRAG]: { roles: [ROLES.POLIZIST], anyoneCanBlock: false }
};

// Reaction state machine states
export const REACTION_STATES = {
  IDLE: 'idle',
  AWAITING_REACTIONS: 'awaiting_reactions',
  BLOCK_ANNOUNCED: 'block_announced',
  AWAITING_ANZEIGE_ON_BLOCK: 'awaiting_anzeige_on_block',
  ANZEIGE_RAISED: 'anzeige_raised',
  AWAITING_BESTECHUNG: 'awaiting_bestechung',
  AWAITING_BESTECHUNG_DECISION: 'awaiting_bestechung_decision',
  STURZ_ANNOUNCED: 'sturz_announced',
  AWAITING_STURZ_BESTECHUNG: 'awaiting_sturz_bestechung',
  AWAITING_STURZ_BESTECHUNG_DECISION: 'awaiting_sturz_bestechung_decision',
  RESOLVING: 'resolving'
};

// AI Profiles from PRD simulation
export const AI_PROFILES = {
  schwach: {
    name: 'Schwach',
    anzeigeRate: 0.22,
    anzeigeTrefferquote: 0.33,
    bluffRate: 0.28,
    blockRate: 0.28,
    auftragRate: 0.38,
    sturzRate: 0.30,
    sturzTrefferquote: 0.25,
    bestechungAnbieten: 0.28,
    bestechungBluffHoch: 0.08,
    bestechungBluffNiedrig: 0.06,
    bestechungAnnehmen: 0.58,
    zieltAufSchwächsten: 0.45
  },
  mittel: {
    name: 'Mittel',
    anzeigeRate: 0.40,
    anzeigeTrefferquote: 0.52,
    bluffRate: 0.44,
    blockRate: 0.48,
    auftragRate: 0.58,
    sturzRate: 0.48,
    sturzTrefferquote: 0.42,
    bestechungAnbieten: 0.48,
    bestechungBluffHoch: 0.18,
    bestechungBluffNiedrig: 0.16,
    bestechungAnnehmen: 0.44,
    zieltAufSchwächsten: 0.68
  },
  stark: {
    name: 'Stark',
    anzeigeRate: 0.56,
    anzeigeTrefferquote: 0.68,
    bluffRate: 0.58,
    blockRate: 0.68,
    auftragRate: 0.72,
    sturzRate: 0.62,
    sturzTrefferquote: 0.56,
    bestechungAnbieten: 0.62,
    bestechungBluffHoch: 0.30,
    bestechungBluffNiedrig: 0.26,
    bestechungAnnehmen: 0.36,
    zieltAufSchwächsten: 0.80
  }
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
