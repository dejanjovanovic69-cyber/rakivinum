type BudgetState = {
  windowStart: number;
  used: number;
  cooldownUntil: number;
};

type BudgetResult = {
  allowed: boolean;
  remaining: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_UNITS = 8;
const DEFAULT_COOLDOWN_MS = 120_000;

const readBudgetState = new Map<string, BudgetState>();

/**
 * Klijentski read budget po ekranu:
 * - ograničava broj mrežnih read pokušaja u vremenskom prozoru
 * - pri prekoračenju aktivira cooldown i forsira cache-only ponašanje
 */
export function consumeReadBudget(scope: string, units = 1): BudgetResult {
  const safeScope = String(scope || "").trim().toLowerCase();
  if (!safeScope) return { allowed: true, remaining: DEFAULT_MAX_UNITS };

  const now = Date.now();
  const state = readBudgetState.get(safeScope) ?? {
    windowStart: now,
    used: 0,
    cooldownUntil: 0,
  };

  if (now < state.cooldownUntil) {
    readBudgetState.set(safeScope, state);
    return { allowed: false, remaining: 0 };
  }

  if (now - state.windowStart >= DEFAULT_WINDOW_MS) {
    state.windowStart = now;
    state.used = 0;
    state.cooldownUntil = 0;
  }

  const nextUsed = state.used + Math.max(1, Math.floor(units));
  if (nextUsed > DEFAULT_MAX_UNITS) {
    state.cooldownUntil = now + DEFAULT_COOLDOWN_MS;
    state.used = DEFAULT_MAX_UNITS;
    readBudgetState.set(safeScope, state);
    return { allowed: false, remaining: 0 };
  }

  state.used = nextUsed;
  readBudgetState.set(safeScope, state);
  return { allowed: true, remaining: Math.max(0, DEFAULT_MAX_UNITS - state.used) };
}

