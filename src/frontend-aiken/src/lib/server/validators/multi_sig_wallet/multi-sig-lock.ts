import { Asset, UTxO } from "@meshsdk/core";
import type { BrowserWallet } from "@meshsdk/core";
import { getTxBuilder } from "../../script-builder";
import { addressToKeyHashAsync } from "../../../addressToKeyHash";



/**
 * Build unsigned transaction for locking assets (server-side, no wallet required)
 * @param scriptAddr - The multi-sig script address
 * @param owners - Array of owner addresses in bech32 format
 * @param threshold - Minimum number of signatures required to unlock
 * @param assets - Assets to lock
 * @param walletAddress - Wallet address for change
 * @param walletUtxos - Wallet UTxOs for transaction inputs
 * @returns Unsigned transaction hex
 */
export async function buildLockTransaction(
    scriptAddr: string,
    owners: string[],
    threshold: number,
    assets: Asset[],
    walletAddress: string,
    walletUtxos: UTxO[]
): Promise<string> {
    // Convert owner addresses (bech32) to verification key hashes
    const ownerHashes = await Promise.all(
        owners.map(async addr => await addressToKeyHashAsync(addr))
    );

    // Build datum: Datum { owners: List<VerificationKeyHash>, threshold: Int }
    const datum = {
        alternative: 0,
        fields: [
            ownerHashes,  // List of verification key hashes
            threshold     // Threshold as integer
        ]
    };

    // Build transaction
    const txBuilder = getTxBuilder();

    const unsignedTx = await txBuilder
        .txOut(scriptAddr, assets)
        .txOutInlineDatumValue(datum)  // Use inline datum (more efficient than datum hash)
        .changeAddress(walletAddress)
        .selectUtxosFrom(walletUtxos)
        .complete();

    return unsignedTx;
}

/**
 * Lock assets to a multi-sig script with specified owners and threshold (client-side with wallet)
 * @param wallet - The user's browser wallet (for signing)
 * @param scriptAddr - The multi-sig script address
 * @param owners - Array of owner addresses in bech32 format (will be converted to verification key hashes)
 * @param threshold - Minimum number of signatures required to unlock
 * @param assets - Assets to lock (e.g., [{ unit: 'lovelace', quantity: '5000000' }])
 * @returns Transaction hash
 */
export async function lockAssetsToMultiSig(
    wallet: BrowserWallet,
    scriptAddr: string,
    owners: string[],
    threshold: number,
    assets: Asset[]
) {
    // Get wallet address for change
    const walletAddress = await wallet.getChangeAddress();
    const walletUtxos = await wallet.getUtxos();

    // Build unsigned transaction
    const unsignedTx = await buildLockTransaction(
        scriptAddr,
        owners,
        threshold,
        assets,
        walletAddress,
        walletUtxos
    );

    // Sign transaction with wallet
    const signedTx = await wallet.signTx(unsignedTx);

    // Submit transaction
    const txHash = await wallet.submitTx(signedTx);

    return txHash;
}