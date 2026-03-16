import { Asset, MeshTxBuilder, UTxO, applyParamsToScript, deserializeAddress, resolveScriptHash } from "@meshsdk/core";
import type { BrowserWallet } from "@meshsdk/core";
import { NETWORK } from "../../../config";
import { blockchainProvider } from "../../script-builder";
import { addressToKeyHashAsync } from "../../../addressToKeyHash";

interface UtxoRef {
    txHash: string;
    outputIndex: number;
}

function findCollateralUtxo(utxos: UTxO[]): UTxO | null {
    return (
        utxos.find((u) => {
            const isOnlyAda = u.output.amount.every((a) => a.unit === "lovelace");
            const ada = BigInt(u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0");
            return isOnlyAda && ada >= BigInt(5_000_000);
        }) ?? null
    );
}

function toTokenNameHex(tokenName: string): string {
    return Array.from(new TextEncoder().encode(tokenName))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function unwrapDoubleEncodedScript(scriptCbor: string): string {
    // script-builder wraps scripts as: 59 + <2-byte-len> + <raw-script-cbor>
    if (scriptCbor.startsWith("59") && scriptCbor.length > 6) {
        return scriptCbor.slice(6);
    }
    return scriptCbor;
}

async function filterResolvableUtxos(walletUtxos: UTxO[]): Promise<UTxO[]> {
    const resolvable: UTxO[] = [];

    for (const utxo of walletUtxos) {
        try {
            // Mesh/Blockfrost coin selection may query tx-by-hash metadata; if the hash is not
            // available on the configured network yet (wrong network or pending tx), build fails.
            await blockchainProvider.fetchUTxOs(utxo.input.txHash);
            resolvable.push(utxo);
        } catch {
            // Skip UTxOs that cannot be resolved on the active Blockfrost network.
        }
    }

    return resolvable;
}

/**
 * Build unsigned transaction for locking assets and minting a 1-shot NFT receipt.
 */
export async function buildLockTransaction(
    scriptAddr: string,
    owners: string[],
    threshold: number,
    assets: Asset[],
    walletAddress: string,
    walletUtxos: UTxO[],
    policyId: string,
    utxoRef: UtxoRef,
    tokenName: string
): Promise<string> {
    const ownerHashes = await Promise.all(owners.map(async (addr) => await addressToKeyHashAsync(addr)));

    const oneShotUtxo = walletUtxos.find(
        (u) => u.input.txHash === utxoRef.txHash && u.input.outputIndex === utxoRef.outputIndex
    );

    if (!oneShotUtxo) {
        throw new Error("The selected one-shot UTxO reference was not found in wallet UTxOs.");
    }

    const selectableUtxos = walletUtxos.filter(
        (u) => !(u.input.txHash === utxoRef.txHash && u.input.outputIndex === utxoRef.outputIndex)
    );

    const multisigScriptHash = deserializeAddress(scriptAddr).scriptHash;
    if (!multisigScriptHash) {
        throw new Error("Could not derive multisig script hash from script address.");
    }

    const outputReferenceParam = {
        alternative: 0,
        fields: [utxoRef.txHash, utxoRef.outputIndex],
    };

    const basePolicyRaw = unwrapDoubleEncodedScript(policyId);
    const policyRaw = applyParamsToScript(basePolicyRaw, [outputReferenceParam, multisigScriptHash]);
    const policyHash = resolveScriptHash(policyRaw, "V3");

    const effectiveTokenName = tokenName.trim() || "MultiSigReceipt";
    const tokenNameHex = toTokenNameHex(effectiveTokenName);

    const datum = {
        alternative: 0,
        // MultisigDatum { signers, threshold, nft_policy, nft_token_name }
        fields: [ownerHashes, threshold, policyHash, tokenNameHex],
    };

    const collateralUtxo = findCollateralUtxo(selectableUtxos);
    if (!collateralUtxo) {
        throw new Error(
            "No suitable collateral UTxO found. You need an ADA-only UTxO with at least 5 ADA for script collateral."
        );
    }

    const protocolParams = await blockchainProvider.fetchProtocolParameters();
    const txBuilder = new MeshTxBuilder({
        fetcher: blockchainProvider,
        submitter: blockchainProvider,
        params: protocolParams,
    });
    txBuilder.setNetwork(NETWORK as "mainnet" | "preprod" | "preview");

    // Consume one-shot UTxO so mint policy can enforce uniqueness.
    const unsignedTx = await txBuilder
        .txIn(
            oneShotUtxo.input.txHash,
            oneShotUtxo.input.outputIndex,
            oneShotUtxo.output.amount,
            oneShotUtxo.output.address
        )
        .txOut(scriptAddr, assets)
        .txOutInlineDatumValue(datum)
        .mintPlutusScriptV3()
        .mint("1", policyHash, tokenNameHex)
        // For minting witnesses, pass the raw parameterized script CBOR.
        .mintingScript(policyRaw)
        .mintRedeemerValue("d87980", "CBOR", { mem: 14000000, steps: 10000000000 })
        .txInCollateral(
            collateralUtxo.input.txHash,
            collateralUtxo.input.outputIndex,
            collateralUtxo.output.amount,
            collateralUtxo.output.address
        )
        .changeAddress(walletAddress)
        .selectUtxosFrom(selectableUtxos)
        .complete();

    return unsignedTx;
}

/**
 * Lock assets and mint a single NFT receipt atomically.
 */
export async function lockAssetsToMultiSigNft(
    wallet: BrowserWallet,
    scriptAddr: string,
    owners: string[],
    threshold: number,
    assets: Asset[],
    policyId: string,
    tokenName: string
): Promise<string> {
    const walletAddress = await wallet.getChangeAddress();
    const walletUtxos = await wallet.getUtxos();

    const resolvableUtxos = await filterResolvableUtxos(walletUtxos);

    if (resolvableUtxos.length === 0) {
        throw new Error(
            "No resolvable wallet UTxOs were found on the active Blockfrost network. " +
            "This usually means a preview/preprod network mismatch or only unconfirmed UTxOs are available."
        );
    }

    const utxoRef: UtxoRef = {
        txHash: resolvableUtxos[0].input.txHash,
        outputIndex: resolvableUtxos[0].input.outputIndex,
    };

    const unsignedTx = await buildLockTransaction(
        scriptAddr,
        owners,
        threshold,
        assets,
        walletAddress,
        resolvableUtxos,
        policyId,
        utxoRef,
        tokenName
    );

    const signedTx = await wallet.signTx(unsignedTx);
    return wallet.submitTx(signedTx);
}
