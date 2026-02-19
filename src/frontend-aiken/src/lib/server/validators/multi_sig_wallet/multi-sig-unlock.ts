// ─────────────────────────────────────────────────────────────────────────────
// multi-sig-unlock.ts
// Using MeshJS MeshTxBuilder API per meshjs.dev reference
// ─────────────────────────────────────────────────────────────────────────────

import { UTxO, MeshTxBuilder, deserializeAddress, serializePlutusScript } from "@meshsdk/core";
import type { BrowserWallet, BlockfrostProvider } from "@meshsdk/core";
import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import {
  createSession,
  getSession,
  applySignature,
  markSubmitted,
  clearSession,
  hasActiveSession,
  exportSessionPayload,
  importSessionPayload,
  type MultiSigSession,
} from "./multi-sig-session";


// ─────────────────────────────────────────────────────────────────────────────
// Create TxBuilder instance
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Helper: Find suitable collateral UTxO
// ─────────────────────────────────────────────────────────────────────────────

function findCollateralUtxo(utxos: UTxO[]): UTxO | null {
  return (
    utxos.find((u) => {
      const isOnlyAda = u.output.amount.every((a) => a.unit === "lovelace");
      const hasEnough = BigInt(
        u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0"
      ) >= BigInt(5_000_000);
      return isOnlyAda && hasEnough;
    }) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Build unlock transaction using MeshTxBuilder (matches reference pattern)
// ─────────────────────────────────────────────────────────────────────────────

export async function buildUnlockTransaction(
  wallet: BrowserWallet,
  provider: BlockfrostProvider,
  scriptAddr: string,
  scriptUtxo: UTxO,
  scriptCbor: string,
  outputAddress: string,
  network: "mainnet" | "preprod" | "preview" = "preprod",
  // signingOwners: the EXACT key hashes that will sign this tx.
  // Only these are declared as requiredSignerHash — the node requires every
  // declared entry to have a witness, so mismatches cause missingSignatories errors.
  // Must be a subset of owners with length >= threshold.
  signingOwners?: string[]
): Promise<{ unsignedTx: string; owners: string[]; threshold: number }> {


  // Parse datum to get owners and threshold
  const { owners, threshold } = parseDatum(scriptUtxo);

  // Ensure owners is a proper string array
  let ownersList: string[];
  if (Array.isArray(owners)) {
    ownersList = owners.map((o: any) => (typeof o === "string" ? o : String(o)));
  } else if (typeof owners === "object") {
    ownersList = Object.values(owners).map((o: any) => String(o));
  } else {
    throw new Error("Invalid owners format in datum.");
  }

  // Get wallet UTxOs and change address
  const walletUtxos = await wallet.getUtxos();
  const changeAddress = await wallet.getChangeAddress();

  const filteredWalletUtxos = walletUtxos.filter(
    (u) =>
      !(
        u.input.txHash === scriptUtxo.input.txHash &&
        u.input.outputIndex === scriptUtxo.input.outputIndex
      )
  );

  // Fetch protocol params for correct cost models (needed for script integrity hash)
  const protocolParams = await provider.fetchProtocolParameters();

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,    // needed for coin selection & UTxO resolution
    submitter: provider,
    params: protocolParams,
  });
  txBuilder.setNetwork(network);

  // Save datum before passing UTxO — fetcher may auto-include datum from chain.
  // To avoid "extraneousDatums" (duplicate), we rely on .txInDatumValue() only.
  const datumCbor = scriptUtxo.output.plutusData!;


  // Blockfrost returns dataHash for ALL datums (it computes the hash of inline datums too).
  // The correct inline datum signal is: plutusData is present (the actual datum CBOR).
  // For hash-only datums: plutusData is null, only dataHash is set.
  const isInlineDatum = !!scriptUtxo.output.plutusData;

  txBuilder
    .spendingPlutusScriptV3()
    .txIn(
      scriptUtxo.input.txHash,
      scriptUtxo.input.outputIndex,
      scriptUtxo.output.amount,
      scriptUtxo.output.address
    )
    .txInScript(scriptCbor);

  if (isInlineDatum) {
    // Datum is embedded in the UTxO output — no witness datum needed
    txBuilder.txInInlineDatumPresent();
  } else {
    // Datum stored as hash on-chain — must provide datum in witness
    txBuilder.txInDatumValue(datumCbor, "CBOR");
  }

  txBuilder.txInRedeemerValue(
    "d87980",
    "CBOR",
    { mem: 14000000, steps: 10000000000 }
  );

  // Declare exactly the signers who will provide witnesses for this tx.
  // The node mandates every declared requiredSignerHash has a matching witness.
  // Using slice(0, threshold) causes "missingSignatories" when the actual signers
  // are not the first N owners — so callers must pass signingOwners explicitly.
  // These are also placed in extra_signatories so the validator can check them.
  const effectiveSigners = signingOwners ?? ownersList.slice(0, threshold);
  if (effectiveSigners.length < threshold) {
    throw new Error(
      `signingOwners must contain at least ${threshold} key hashes (got ${effectiveSigners.length}).`
    );
  }
  effectiveSigners.forEach((ownerPkh: string) => {
    if (ownerPkh.length === 56) {
      txBuilder.requiredSignerHash(ownerPkh);
    }
  });

  // Output - send script funds to recipient
  txBuilder.txOut(outputAddress, scriptUtxo.output.amount);

  // Find and add collateral
  const collateralUtxo = findCollateralUtxo(walletUtxos);
  if (collateralUtxo) {
    txBuilder.txInCollateral(
      collateralUtxo.input.txHash,
      collateralUtxo.input.outputIndex,
      collateralUtxo.output.amount,
      collateralUtxo.output.address
    );
  }


  // Complete transaction
  const unsignedTx = await txBuilder
    .changeAddress(changeAddress)
    .selectUtxosFrom(filteredWalletUtxos)
    .complete();


  return { unsignedTx, owners: ownersList, threshold };
}


// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Initiator: build + first partial sign + create session
// Automatically extracts required signers from the datum (no need to pass signerAddresses)
// ─────────────────────────────────────────────────────────────────────────────

export async function initiateUnlock(
  wallet: BrowserWallet,
  provider: BlockfrostProvider,
  scriptAddr: string,
  scriptUtxo: UTxO,
  scriptCbor: string,
  outputAddress: string,
  network: "mainnet" | "preprod" | "preview" = "preprod",
  // Pass the key hashes of EXACTLY the owners who will sign.
  // If omitted, defaults to owners[0..threshold-1] which only works when
  // those specific wallets participate.
  signingOwners?: string[]
): Promise<MultiSigSession> {
  if (hasActiveSession()) {
    throw new Error(
      "A multisig session is already active. Clear it before starting a new one."
    );
  }

  const changeAddress = await wallet.getChangeAddress();
  const { pubKeyHash: initiatorPkh } = deserializeAddress(changeAddress);

  // Build the unsigned transaction (with all required signers already set)
  const { unsignedTx, owners, threshold } = await buildUnlockTransaction(
    wallet,
    provider,
    scriptAddr,
    scriptUtxo,
    scriptCbor,
    outputAddress,
    network,
    signingOwners
  );

  // Initiator partially signs (partial = true)
  // This preserves witness slots for other signers
  const partialTx = await wallet.signTx(unsignedTx, true);

  // Create session
  const session = createSession({
    unsignedTx,
    partialTx,
    threshold,
    initiatorPkh,
  });

  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Co-signer: load session → validate → sign → update session
// ─────────────────────────────────────────────────────────────────────────────

export async function coSign(wallet: BrowserWallet): Promise<MultiSigSession> {
  const session = getSession();
  if (!session) throw new Error("No active session found or session has expired.");

  const changeAddress = await wallet.getChangeAddress();
  const { pubKeyHash: walletPkh } = deserializeAddress(changeAddress);

  // Guards
  // Note: We allow any wallet to attempt signing - the on-chain script will validate
  // if they're actually a required signer. This simplifies testing.
  if (session.collectedSigners.includes(walletPkh)) {
    throw new Error("This wallet has already signed this session.");
  }
  if (session.status !== "pending") {
    throw new Error(`Session is already "${session.status}".`);
  }

  // Always sign partially — wallets throw "canOnlySignPartially" when the tx
  // has requiredSignerHash entries that don't belong to the current wallet,
  // which is always the case in a multi-sig flow. The transaction is considered
  // complete once all threshold signatures have been collected (checked in submitUnlock).
  const newPartialTx = await wallet.signTx(session.partialTx, true);

  // Persist
  const updated = applySignature({ signerPkh: walletPkh, newPartialTx });
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Submit once threshold is reached
// ─────────────────────────────────────────────────────────────────────────────

export async function submitUnlock(wallet: BrowserWallet): Promise<string> {
  const session = getSession();
  if (!session) throw new Error("No active session found or session has expired.");

  if (session.status !== "ready") {
    throw new Error(
      `Not enough signatures: ${session.collectedSigners.length}/${session.threshold}. ` +
      `Waiting on ${session.threshold - session.collectedSigners.length} more signer(s).`
    );
  }

  // Submit the fully signed transaction
  const txHash = await wallet.submitTx(session.partialTx);
  markSubmitted(txHash);
  return txHash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Datum parser
// ─────────────────────────────────────────────────────────────────────────────

export function parseDatum(utxo: UTxO): { owners: string[]; threshold: number } {
  if (!utxo.output.plutusData) {
    throw new Error("UTxO does not contain Plutus data.");
  }

  const datum = utxo.output.plutusData;

  if (typeof datum === "string") {
    try {
      const plutusData = CSL.PlutusData.from_hex(datum);
      const constr = plutusData.as_constr_plutus_data();
      if (!constr) throw new Error("Not a constructor datum.");

      const fields = constr.data();

      const ownersList = fields.get(0).as_list();
      if (!ownersList) throw new Error("Owners field is not a list.");

      const owners: string[] = [];
      for (let i = 0; i < ownersList.len(); i++) {
        const bytes = ownersList.get(i).as_bytes();
        if (bytes) owners.push(Buffer.from(bytes).toString("hex"));
      }

      const thresholdData = fields.get(1).as_integer();
      if (!thresholdData) throw new Error("Threshold field is not an integer.");

      return { owners, threshold: parseInt(thresholdData.to_str()) };
    } catch (e: any) {
      throw new Error(`Failed to parse datum: ${e.message}`);
    }
  }

  // Already parsed object
  const obj = datum as any;
  if (obj.fields && Array.isArray(obj.fields)) {
    return { owners: obj.fields[0], threshold: obj.fields[1] };
  }

  throw new Error("Unrecognised datum format.");
}

// Re-export session helpers so consumers only need to import from here
export {
  exportSessionPayload,
  importSessionPayload,
  clearSession,
  getSession,
  hasActiveSession,
};