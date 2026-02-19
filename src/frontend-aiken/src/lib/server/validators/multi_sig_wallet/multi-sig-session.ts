// ─────────────────────────────────────────────────────────────────────────────
// Multi-Sig Session Manager
// Pure client-side: sessionStorage (no DB required)
// Session auto-expires after SESSION_TTL_MS (default 10 minutes)
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_KEY = "multisig_session";
export const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface MultiSigSession {
  sessionId: string;
  unsignedTx: string;          // original unsigned tx (never mutated)
  partialTx: string;           // accumulates signatures on every co-sign
  collectedSigners: string[];  // PKHs who have already signed
  threshold: number;           // how many signatures needed (from datum)
  status: "pending" | "ready" | "submitted";
  createdAt: number;           // Date.now() — used for TTL check
  expiresAt: number;           // createdAt + SESSION_TTL_MS
  txHash?: string;
}

// ─── TTL helpers ──────────────────────────────────────────────────────────────

function isExpired(session: MultiSigSession): boolean {
  return Date.now() > session.expiresAt;
}

function getRemainingMs(session: MultiSigSession): number {
  return Math.max(0, session.expiresAt - Date.now());
}

// ─── Storage helpers (SSR-safe) ───────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readSession(): MultiSigSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: MultiSigSession = JSON.parse(raw);
    // Auto-clear if expired
    if (isExpired(session)) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function writeSession(session: MultiSigSession): void {
  if (!isBrowser()) return;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (!isBrowser()) return;
  sessionStorage.removeItem(SESSION_KEY);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if there is a live (non-expired) session already.
 * Use this to decide whether the current user is the initiator or a co-signer.
 */
export function hasActiveSession(): boolean {
  return readSession() !== null;
}

/**
 * Create a brand-new session (called by the first signer / initiator).
 * No need to track required signers - the on-chain script enforces this.
 */
export function createSession(params: {
  unsignedTx: string;
  partialTx: string;       // already signed once by the initiator
  threshold: number;
  initiatorPkh: string;
}): MultiSigSession {
  const now = Date.now();
  const session: MultiSigSession = {
    sessionId: crypto.randomUUID(),
    unsignedTx: params.unsignedTx,
    partialTx: params.partialTx,
    collectedSigners: [params.initiatorPkh],
    threshold: params.threshold,
    status: "pending",
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  writeSession(session);
  return session;
}

/**
 * Load the current session. Returns null if none or if expired.
 */
export function getSession(): MultiSigSession | null {
  return readSession();
}

/**
 * Apply a new co-signature to the session.
 * Returns the updated session or throws if invalid.
 */
export function applySignature(params: {
  signerPkh: string;
  newPartialTx: string;  // tx with this signer's sig merged in
}): MultiSigSession {
  const session = readSession();
  if (!session) throw new Error("No active session or session expired.");

  if (session.status !== "pending") {
    throw new Error(`Session is already "${session.status}".`);
  }

  if (session.collectedSigners.includes(params.signerPkh)) {
    throw new Error("This wallet has already signed this session.");
  }

  // Note: We don't validate if signer is in requiredSigners - let the script do that on-chain

  const updatedCollected = [...session.collectedSigners, params.signerPkh];
  const thresholdMet = updatedCollected.length >= session.threshold;

  const updated: MultiSigSession = {
    ...session,
    partialTx: params.newPartialTx,
    collectedSigners: updatedCollected,
    status: thresholdMet ? "ready" : "pending",
  };

  writeSession(updated);
  return updated;
}

/**
 * Mark the session as submitted and store the txHash.
 * Call this right after a successful submitTx().
 */
export function markSubmitted(txHash: string): void {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, status: "submitted", txHash });
  // Remove after a short grace period so UI can show success
  setTimeout(clearSession, 3000);
}

/**
 * Returns a human-readable status snapshot — safe to call on SSR (returns null).
 */
export function getSessionStatus(): {
  signed: number;
  required: number;
  status: MultiSigSession["status"];
  remainingMs: number;
  sessionId: string;
} | null {
  const session = readSession();
  if (!session) return null;

  return {
    signed: session.collectedSigners.length,
    required: session.threshold,
    status: session.status,
    remainingMs: getRemainingMs(session),
    sessionId: session.sessionId,
  };
}

/**
 * Export the current partialTx as a shareable string.
 * Co-signers on other tabs can import it via importPartialTx().
 */
export function exportSessionPayload(): string | null {
  const session = readSession();
  if (!session) return null;
  // Encode only what the co-signer needs
  return btoa(
    JSON.stringify({
      sessionId: session.sessionId,
      partialTx: session.partialTx,
      collectedSigners: session.collectedSigners,
      threshold: session.threshold,
      expiresAt: session.expiresAt,
    })
  );
}

/**
 * Import a session payload shared by the initiator.
 * Used when co-signers are on a different tab/machine but same origin.
 */
export function importSessionPayload(payload: string): MultiSigSession | null {
  try {
    const data = JSON.parse(atob(payload));
    if (Date.now() > data.expiresAt) {
      throw new Error("Imported session has already expired.");
    }
    const existing = readSession();
    // Don't overwrite a newer session
    if (existing && existing.sessionId === data.sessionId) return existing;

    const session: MultiSigSession = {
      ...data,
      unsignedTx: data.partialTx, // co-signers start from current partial
      status: "pending",
      createdAt: Date.now(),
    };
    writeSession(session);
    return session;
  } catch (e: any) {
    throw new Error(`Failed to import session: ${e.message}`);
  }
}