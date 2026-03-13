import { MeshWallet, deserializeAddress } from "@meshsdk/core";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { getScript, getTxBuilder, getBlockchainProvider } from "./common";

// ─── Config ───────────────────────────────────────────────────────────────────
// 2-of-3 multi-sig: owner1 pays to lock, all 3 owner hashes baked into script.
// Threshold = 2 means any 2 of the 3 owners must sign to unlock.
const LOVELACE_TO_LOCK = "5000000"; // 5 ADA
const THRESHOLD = 2;                // 2-of-3 signatures required to unlock
// ──────────────────────────────────────────────────────────────────────────────

async function getOwnerHash(skFile: string): Promise<string> {
    const sk = fs.readFileSync(path.join(__dirname, skFile)).toString();
    const w = new MeshWallet({ networkId: 0, key: { type: "root", bech32: sk } });
    const addr = (await w.getUnusedAddresses())[0];
    return deserializeAddress(addr).pubKeyHash;
}

async function main() {
    const provider = getBlockchainProvider();

    // Load the paying wallet (owner1 funds the lock tx)
    const skPath = path.join(__dirname, "owner1.sk");
    const wallet = new MeshWallet({
        networkId: 0,
        fetcher: provider,
        submitter: provider,
        key: {
            type: "root",
            bech32: fs.readFileSync(skPath).toString(),
        },
    });

    // Derive key hashes for all 3 owners
    const owner1Hash = await getOwnerHash("owner1.sk");
    const owner2Hash = await getOwnerHash("owner2.sk");
    const owner3Hash = await getOwnerHash("owner3.sk");

    console.log("Owner 1 hash:", owner1Hash);
    console.log("Owner 2 hash:", owner2Hash);
    console.log("Owner 3 hash:", owner3Hash);

    // Parameterise script with all 3 distinct owner hashes
    const { scriptAddr } = getScript(owner1Hash, owner2Hash, owner3Hash);
    console.log("Script address:", scriptAddr);

    // Datum: MultisigDatum { threshold: Int }  →  Constr(0, [Int(threshold)])
    const datum = {
        alternative: 0,
        fields: [THRESHOLD],
    };

    const txBuilder = getTxBuilder();
    const walletUtxos = await wallet.getUtxos();
    const changeAddress = await wallet.getChangeAddress();

    const unsignedTx = await txBuilder
        .txOut(scriptAddr, [{ unit: "lovelace", quantity: LOVELACE_TO_LOCK }])
        .txOutInlineDatumValue(datum)
        .changeAddress(changeAddress)
        .selectUtxosFrom(walletUtxos)
        .complete();

    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    console.log("✅ Locked! TX hash:", txHash);
    console.log(`   Amount : ${Number(LOVELACE_TO_LOCK) / 1_000_000} ADA`);
    console.log(`   Threshold: ${THRESHOLD} of 3 owners must sign to unlock`);
    console.log("\nSave the TX hash — you'll need it to unlock.");
}

main();
