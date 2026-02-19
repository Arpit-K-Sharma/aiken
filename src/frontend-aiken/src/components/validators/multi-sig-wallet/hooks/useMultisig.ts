// ─────────────────────────────────────────────────────────────────────────────
// useMultiSig.ts — React hook (CSR only)
// Manages the full lifecycle: initiate → co-sign → submit → expire
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { BrowserWallet } from "@meshsdk/core";
import { UTxO } from "@meshsdk/core";
import { getBlockfrostProvider, NETWORK } from "@/lib/config";
import {
  getSession,
  getSessionStatus,
  clearSession,
  exportSessionPayload,
  importSessionPayload,
  SESSION_TTL_MS,
  type MultiSigSession,
} from "../../../../lib/server/validators/multi_sig_wallet/multi-sig-session";
import {
  initiateUnlock,
  coSign,
  submitUnlock,
} from "../../../../lib/server/validators/multi_sig_wallet/multi-sig-unlock";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MultiSigStep =
  | "idle"          // no session
  | "building"      // building unsigned tx
  | "signing"       // wallet signing in progress
  | "pending"       // waiting for co-signers
  | "cosigning"     // a co-signer is signing
  | "ready"         // threshold met, can submit
  | "submitting"    // submitTx in progress
  | "submitted"     // done ✓
  | "expired"       // session timed out
  | "error";        // something went wrong

export interface MultiSigState {
  step: MultiSigStep;
  session: MultiSigSession | null;
  signed: number;
  required: number;
  remainingMs: number;          // countdown in ms
  txHash: string | null;
  error: string | null;
  sharePayload: string | null;  // base64 for co-signers to import
}

export interface UseMultiSigReturn extends MultiSigState {
  // Initiator action
  initiate: (params: {
    wallet: BrowserWallet;
    scriptAddr: string;
    scriptUtxo: UTxO;
    scriptCbor: string;
    outputAddress: string;
    // The exact key hashes of owners who will sign this tx.
    // Must have length >= threshold. Required to avoid missingSignatories errors.
    signingOwners: string[];
  }) => Promise<void>;

  // Co-signer action
  cosign: (wallet: BrowserWallet) => Promise<void>;

  // Final submit
  submit: (wallet: BrowserWallet) => Promise<void>;

  // Share helpers
  copySharePayload: () => Promise<void>;
  loadFromPayload: (payload: string) => void;

  // Reset / cleanup
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMultiSig(): UseMultiSigReturn {
  const [state, setState] = useState<MultiSigState>({
    step: "idle",
    session: null,
    signed: 0,
    required: 0,
    remainingMs: 0,
    txHash: null,
    error: null,
    sharePayload: null,
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Sync state from sessionStorage ──────────────────────────────────────────

  const syncFromStorage = useCallback(() => {
    const status = getSessionStatus();
    const session = getSession();

    if (!status || !session) {
      setState((prev) => ({
        ...prev,
        step: prev.step === "submitted" ? "submitted" : "idle",
        session: null,
        signed: 0,
        required: 0,
        remainingMs: 0,
        sharePayload: null,
      }));
      stopTimer();
      return;
    }

    if (status.remainingMs === 0) {
      setState((prev) => ({
        ...prev,
        step: "expired",
        session: null,
        remainingMs: 0,
      }));
      clearSession();
      stopTimer();
      return;
    }

    setState((prev) => ({
      ...prev,
      session,
      signed: status.signed,
      required: status.required,
      remainingMs: status.remainingMs,
      step: mapStatusToStep(status.status, prev.step),
      sharePayload: exportSessionPayload(),
    }));
  }, []);

  // ── Countdown timer ──────────────────────────────────────────────────────────

  function startTimer() {
    stopTimer();
    timerRef.current = setInterval(() => {
      syncFromStorage();
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // On mount: restore any existing session (e.g. page refresh)
  useEffect(() => {
    syncFromStorage();
    const session = getSession();
    if (session) startTimer();
    return () => stopTimer();
  }, []);

  // ── Error helper ─────────────────────────────────────────────────────────────

  function setError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    setState((prev) => ({ ...prev, step: "error", error: message }));
    stopTimer();
  }

  // ── Initiate ─────────────────────────────────────────────────────────────────

  const initiate = useCallback(
    async (params: {
      wallet: BrowserWallet;
      scriptAddr: string;
      scriptUtxo: UTxO;
      scriptCbor: string;
      outputAddress: string;
      signingOwners: string[];
    }) => {
      try {
        setState((prev) => ({
          ...prev,
          step: "building",
          error: null,
          txHash: null,
        }));

        const provider = getBlockfrostProvider();
        const network = NETWORK as "mainnet" | "preprod" | "preview";

        // initiateUnlock automatically extracts required signers from datum
        const session = await initiateUnlock(
          params.wallet,
          provider,
          params.scriptAddr,
          params.scriptUtxo,
          params.scriptCbor,
          params.outputAddress,
          network,
          params.signingOwners
        );

        setState((prev) => ({
          ...prev,
          step: session.status === "ready" ? "ready" : "pending",
          session,
          signed: session.collectedSigners.length,
          required: session.threshold,
          remainingMs: SESSION_TTL_MS,
          sharePayload: exportSessionPayload(),
          error: null,
        }));

        startTimer();
      } catch (err) {
        setError(err);
      }
    },
    []
  );

  // ── Co-sign ──────────────────────────────────────────────────────────────────

  const cosign = useCallback(async (wallet: BrowserWallet) => {
    try {
      setState((prev) => ({ ...prev, step: "cosigning", error: null }));

      const updated = await coSign(wallet);

      setState((prev) => ({
        ...prev,
        step: updated.status === "ready" ? "ready" : "pending",
        session: updated,
        signed: updated.collectedSigners.length,
        required: updated.threshold,
        sharePayload: exportSessionPayload(),
        error: null,
      }));
    } catch (err) {
      setError(err);
    }
  }, []);

  // ── Submit ───────────────────────────────────────────────────────────────────

  const submit = useCallback(async (wallet: BrowserWallet) => {
    try {
      setState((prev) => ({ ...prev, step: "submitting", error: null }));

      const txHash = await submitUnlock(wallet);

      setState((prev) => ({
        ...prev,
        step: "submitted",
        txHash,
        session: null,
        sharePayload: null,
        remainingMs: 0,
      }));

      stopTimer();
    } catch (err) {
      setError(err);
    }
  }, []);

  // ── Share helpers ─────────────────────────────────────────────────────────────

  const copySharePayload = useCallback(async () => {
    const payload = exportSessionPayload();
    if (!payload) return;
    await navigator.clipboard.writeText(payload);
  }, []);

  const loadFromPayload = useCallback((payload: string) => {
    try {
      const session = importSessionPayload(payload);
      if (!session) throw new Error("Invalid or expired payload.");
      syncFromStorage();
      startTimer();
    } catch (err) {
      setError(err);
    }
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    clearSession();
    stopTimer();
    setState({
      step: "idle",
      session: null,
      signed: 0,
      required: 0,
      remainingMs: 0,
      txHash: null,
      error: null,
      sharePayload: null,
    });
  }, []);

  return {
    ...state,
    initiate,
    cosign,
    submit,
    copySharePayload,
    loadFromPayload,
    reset,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function mapStatusToStep(
  sessionStatus: MultiSigSession["status"],
  currentStep: MultiSigStep
): MultiSigStep {
  if (sessionStatus === "submitted") return "submitted";
  if (sessionStatus === "ready") return "ready";
  if (sessionStatus === "pending") {
    // Don't clobber an in-progress cosigning step
    if (currentStep === "cosigning" || currentStep === "submitting") {
      return currentStep;
    }
    return "pending";
  }
  return currentStep;
}

/**
 * Format remaining ms into MM:SS string
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}