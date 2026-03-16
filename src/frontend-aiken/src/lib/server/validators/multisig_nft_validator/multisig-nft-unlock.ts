// ─────────────────────────────────────────────────────────────────────────────
// multisig-nft-unlock.ts
// Unlocks multi-sig funds and burns the NFT receipt in one transaction.
// ─────────────────────────────────────────────────────────────────────────────

import { UTxO, MeshTxBuilder, deserializeAddress, resolveScriptHash } from "@meshsdk/core";
import type { BrowserWallet, BlockfrostProvider } from "@meshsdk/core";
import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import { BLOCKFROST_API_URL, BLOCKFROST_PROJECT_ID } from "../../../config";
import { applyParamsToScript } from "@meshsdk/core";
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
} from "../multi_sig_wallet/multi-sig-session";

function findCollateralUtxo(utxos: UTxO[]): UTxO | null {
    return (
        utxos.find((u) => {
            const isOnlyAda = u.output.amount.every((a) => a.unit === "lovelace");
            const hasEnough =
                BigInt(u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0") >=
                BigInt(5_000_000);
            return isOnlyAda && hasEnough;
        }) ?? null
    );
}

function toTokenNameHex(tokenName: string): string {
    return Array.from(new TextEncoder().encode(tokenName))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function unwrapDoubleEncodedScript(scriptCbor: string): string {
    if (scriptCbor.startsWith("59") && scriptCbor.length > 6) {
        return scriptCbor.slice(6);
    }
    return scriptCbor;
}

async function fetchTxInputReferences(txHash: string): Promise<Array<{ txHash: string; outputIndex: number }>> {
    if (!BLOCKFROST_PROJECT_ID) return [];
    try {
        const res = await fetch(`${BLOCKFROST_API_URL}/txs/${txHash}/utxos`, {
            headers: { project_id: BLOCKFROST_PROJECT_ID },
        });
        if (!res.ok) return [];

        const data = await res.json();
        const inputs = Array.isArray(data?.inputs) ? data.inputs : [];

        return inputs
            .filter((i: any) => typeof i?.tx_hash === "string" && Number.isInteger(i?.output_index))
            .map((i: any) => ({ txHash: i.tx_hash, outputIndex: i.output_index }));
    } catch {
        return [];
    }
}

async function resolveParameterizedPolicyScriptForBurn(
    policyScriptCbor: string,
    expectedPolicyHash: string,
    lockTxHash: string,
    multisigScriptHash: string
): Promise<string> {
    const basePolicyRaw = unwrapDoubleEncodedScript(policyScriptCbor);

    // If caller already provided the exact policy script, use it directly.
    if (resolveScriptHash(basePolicyRaw, "V3") === expectedPolicyHash) {
        return basePolicyRaw;
    }

    // Rebuild the parameterized policy by trying each input of the lock tx as utxo_ref.
    const candidates = await fetchTxInputReferences(lockTxHash);
    for (const ref of candidates) {
        const outputReferenceParam = {
            alternative: 0,
            fields: [ref.txHash, ref.outputIndex],
        };
        const candidateRaw = applyParamsToScript(basePolicyRaw, [outputReferenceParam, multisigScriptHash]);
        if (resolveScriptHash(candidateRaw, "V3") === expectedPolicyHash) {
            return candidateRaw;
        }
    }

    throw new Error(
        "Unable to reconstruct the NFT policy witness for burn. The provided policy script does not match the datum nft_policy hash."
    );
}

// Combined ExUnits across all scripts in a tx must stay below protocol max.
// We split budgets between spend validator and burn policy to avoid overshooting.
const SPEND_REDEEMER_EX_UNITS = { mem: 10_000_000, steps: 7_000_000_000 };
const BURN_REDEEMER_EX_UNITS = { mem: 4_000_000, steps: 2_000_000_000 };

function removeBurnedNftFromAmount(amount: { unit: string; quantity: string }[], policyHash: string, tokenNameHex: string) {
    const targetUnit = `${policyHash}${tokenNameHex}`;
    const adjusted = amount
        .map((asset) => {
            if (asset.unit !== targetUnit) return asset;
            const nextQty = BigInt(asset.quantity) - BigInt(1);
            return { ...asset, quantity: nextQty.toString() };
        })
        .filter((asset) => BigInt(asset.quantity) > BigInt(0));

    return adjusted;
}

export async function buildUnlockTransaction(
    wallet: BrowserWallet,
    provider: BlockfrostProvider,
    scriptAddr: string,
    scriptUtxo: UTxO,
    scriptCbor: string,
    outputAddress: string,
    network: "mainnet" | "preprod" | "preview" = "preprod",
    signingOwners?: string[],
    policyId?: string,
    tokenName: string = ""
): Promise<{ unsignedTx: string; owners: string[]; threshold: number }> {
    const { owners, threshold, nftPolicy, nftTokenName } = parseDatum(scriptUtxo);

    let ownersList: string[];
    if (Array.isArray(owners)) {
        ownersList = owners.map((o: any) => (typeof o === "string" ? o : String(o)));
    } else if (typeof owners === "object") {
        ownersList = Object.values(owners).map((o: any) => String(o));
    } else {
        throw new Error("Invalid owners format in datum.");
    }

    const walletUtxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const filteredWalletUtxos = walletUtxos.filter(
        (u) =>
            !(
                u.input.txHash === scriptUtxo.input.txHash &&
                u.input.outputIndex === scriptUtxo.input.outputIndex
            )
    );

    const protocolParams = await provider.fetchProtocolParameters();

    const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        submitter: provider,
        params: protocolParams,
    });
    txBuilder.setNetwork(network);

    const datumCbor = scriptUtxo.output.plutusData!;
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
        txBuilder.txInInlineDatumPresent();
    } else {
        txBuilder.txInDatumValue(datumCbor, "CBOR");
    }

    txBuilder.txInRedeemerValue("d87980", "CBOR", SPEND_REDEEMER_EX_UNITS);

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

    const effectiveTokenName = nftTokenName || tokenName || "MultiSigReceipt";
    const tokenNameHex = toTokenNameHex(effectiveTokenName);
    const burnPolicyHash = nftPolicy || (policyId ? resolveScriptHash(policyId, "V3") : undefined);

    if (!burnPolicyHash) {
        throw new Error("Missing NFT policy hash. Ensure datum includes nft_policy or provide a valid policy script.");
    }

    // The NFT is burned in this tx, so it must not be requested in the recipient output.
    const outputAmount = removeBurnedNftFromAmount(scriptUtxo.output.amount, burnPolicyHash, tokenNameHex);
    txBuilder.txOut(outputAddress, outputAmount);

    if (policyId) {
        const multisigScriptHash = deserializeAddress(scriptAddr).scriptHash;
        if (!multisigScriptHash) {
            throw new Error("Could not derive multisig script hash from script address.");
        }

        const burnPolicyScript = await resolveParameterizedPolicyScriptForBurn(
            policyId,
            burnPolicyHash,
            scriptUtxo.input.txHash,
            multisigScriptHash
        );

        // Burn the receipt NFT in the same unlock tx so withdrawal and receipt consumption
        // remain atomic and cannot be separated.
        txBuilder
            .mintPlutusScriptV3()
            .mint("-1", burnPolicyHash, tokenNameHex)
            .mintingScript(burnPolicyScript)
            .mintRedeemerValue("d87a80", "CBOR", BURN_REDEEMER_EX_UNITS);
    } else {
        throw new Error("Policy script CBOR is required to burn the NFT during unlock.");
    }

    const collateralUtxo = findCollateralUtxo(walletUtxos);
    if (collateralUtxo) {
        txBuilder.txInCollateral(
            collateralUtxo.input.txHash,
            collateralUtxo.input.outputIndex,
            collateralUtxo.output.amount,
            collateralUtxo.output.address
        );
    }

    const unsignedTx = await txBuilder
        .changeAddress(changeAddress)
        .selectUtxosFrom(filteredWalletUtxos)
        .complete();

    return { unsignedTx, owners: ownersList, threshold };
}

export async function initiateUnlock(
    wallet: BrowserWallet,
    provider: BlockfrostProvider,
    scriptAddr: string,
    scriptUtxo: UTxO,
    scriptCbor: string,
    outputAddress: string,
    network: "mainnet" | "preprod" | "preview" = "preprod",
    signingOwners?: string[],
    policyId?: string,
    tokenName: string = ""
): Promise<MultiSigSession> {
    if (hasActiveSession()) {
        throw new Error("A multisig session is already active. Clear it before starting a new one.");
    }

    const changeAddress = await wallet.getChangeAddress();
    const { pubKeyHash: initiatorPkh } = deserializeAddress(changeAddress);

    const { unsignedTx, threshold } = await buildUnlockTransaction(
        wallet,
        provider,
        scriptAddr,
        scriptUtxo,
        scriptCbor,
        outputAddress,
        network,
        signingOwners,
        policyId,
        tokenName
    );

    const partialTx = await wallet.signTx(unsignedTx, true);

    const session = createSession({
        unsignedTx,
        partialTx,
        threshold,
        initiatorPkh,
    });

    return session;
}

export async function coSign(wallet: BrowserWallet): Promise<MultiSigSession> {
    const session = getSession();
    if (!session) throw new Error("No active session found or session has expired.");

    const changeAddress = await wallet.getChangeAddress();
    const { pubKeyHash: walletPkh } = deserializeAddress(changeAddress);

    if (session.collectedSigners.includes(walletPkh)) {
        throw new Error("This wallet has already signed this session.");
    }
    if (session.status !== "pending") {
        throw new Error(`Session is already "${session.status}".`);
    }

    const newPartialTx = await wallet.signTx(session.partialTx, true);
    const updated = applySignature({ signerPkh: walletPkh, newPartialTx });
    return updated;
}

export async function submitUnlock(wallet: BrowserWallet): Promise<string> {
    const session = getSession();
    if (!session) throw new Error("No active session found or session has expired.");

    if (session.status !== "ready") {
        throw new Error(
            `Not enough signatures: ${session.collectedSigners.length}/${session.threshold}. ` +
            `Waiting on ${session.threshold - session.collectedSigners.length} more signer(s).`
        );
    }

    const txHash = await wallet.submitTx(session.partialTx);
    markSubmitted(txHash);
    return txHash;
}

export function parseDatum(utxo: UTxO): { owners: string[]; threshold: number; nftPolicy?: string; nftTokenName?: string } {
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

            const nftPolicyBytes = fields.get(2)?.as_bytes();
            const nftPolicy = nftPolicyBytes ? Buffer.from(nftPolicyBytes).toString("hex") : undefined;
            const nftTokenNameBytes = fields.get(3)?.as_bytes();
            const nftTokenName = nftTokenNameBytes ? new TextDecoder().decode(nftTokenNameBytes) : undefined;

            return { owners, threshold: parseInt(thresholdData.to_str()), nftPolicy, nftTokenName };
        } catch (e: any) {
            throw new Error(`Failed to parse datum: ${e.message}`);
        }
    }

    const obj = datum as any;
    if (obj.fields && Array.isArray(obj.fields)) {
        const tokenName = typeof obj.fields[3] === "string" ? obj.fields[3] : undefined;
        return { owners: obj.fields[0], threshold: obj.fields[1], nftPolicy: obj.fields[2], nftTokenName: tokenName };
    }

    throw new Error("Unrecognised datum format.");
}

export {
    exportSessionPayload,
    importSessionPayload,
    clearSession,
    getSession,
    hasActiveSession,
};
