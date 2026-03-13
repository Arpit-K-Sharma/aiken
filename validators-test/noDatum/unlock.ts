import { MeshWallet, deserializeAddress, UTxO } from "@meshsdk/core";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { getScript, getTxBuilder, getBlockchainProvider } from "./common";


// LOCK_TX_HASH=<hash> npx tsx validators-test/noDatum/unlock.ts

// ─── Config ───────────────────────────────────────────────────────────────────
// Must match the values used in lock.ts so the script address resolves the same.
const TX_HASH = process.env.LOCK_TX_HASH || "";   // set via env or edit here
// ──────────────────────────────────────────────────────────────────────────────

async function getOwnerHash(skFile: string): Promise<string> {
    const sk = fs.readFileSync(path.join(__dirname, skFile)).toString();
    const w = new MeshWallet({ networkId: 0, key: { type: "root", bech32: sk } });
    const addr = (await w.getUnusedAddresses())[0];
    return deserializeAddress(addr).pubKeyHash;
}

async function main() {
    if (!TX_HASH) {
        console.error("❌ Please set LOCK_TX_HASH=<txHash> before running.");
        console.error("   e.g.  LOCK_TX_HASH=abc123... npx tsx validators-test/noDatum/unlock.ts");
        process.exit(1);
    }

    const provider = getBlockchainProvider();

    // owner1 and owner2 sign (2-of-3 satisfies threshold=2)
    const owner1Sk = fs.readFileSync(path.join(__dirname, "owner1.sk")).toString();
    const owner2Sk = fs.readFileSync(path.join(__dirname, "owner2.sk")).toString();

    const wallet1 = new MeshWallet({
        networkId: 0,
        fetcher: provider,
        submitter: provider,
        key: { type: "root", bech32: owner1Sk },
    });
    const wallet2 = new MeshWallet({
        networkId: 0,
        key: { type: "root", bech32: owner2Sk },
    });

    // Derive key hashes for all 3 owners (must match lock.ts exactly)
    const owner1Hash = await getOwnerHash("owner1.sk");
    const owner2Hash = await getOwnerHash("owner2.sk");
    const owner3Hash = await getOwnerHash("owner3.sk");

    console.log("Owner 1 hash:", owner1Hash);
    console.log("Owner 2 hash:", owner2Hash);
    console.log("Owner 3 hash:", owner3Hash);

    // Reconstruct the same script used when locking
    const { scriptCbor, scriptAddr } = getScript(owner1Hash, owner2Hash, owner3Hash);
    console.log("Script address:", scriptAddr);

    // Fetch UTxOs at the script address and find the one from our lock tx
    const utxos: UTxO[] = await provider.fetchAddressUTxOs(scriptAddr);
    const scriptUtxo = utxos.find(
        (u) => u.input.txHash === TX_HASH
    );

    if (!scriptUtxo) {
        console.error("❌ No UTxO found at script address for tx:", TX_HASH);
        process.exit(1);
    }

    console.log("Found UTxO:", scriptUtxo.input.txHash, "#", scriptUtxo.input.outputIndex);

    // Read threshold from inline datum: MultisigDatum { threshold: Int } = Constr(0, [Int])
    const rawDatum = scriptUtxo.output.plutusData;
    if (!rawDatum) {
        console.error("❌ UTxO has no inline datum.");
        process.exit(1);
    }

    // Redeemer: MultisigRedeemer.Spend = Constr(0, [])
    const redeemer = { alternative: 0, fields: [] };

    const txBuilder = getTxBuilder();
    const walletUtxos = await wallet1.getUtxos();
    const changeAddress = await wallet1.getChangeAddress();

    // Find a collateral UTxO (pure ADA, >= 5 ADA)
    const collateral = walletUtxos.find(
        (u) =>
            u.output.amount.every((a) => a.unit === "lovelace") &&
            BigInt(u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? 0) >= 5_000_000n
    );
    if (!collateral) {
        console.error("❌ No suitable collateral UTxO (pure ADA, >= 5 ADA) found in wallet.");
        process.exit(1);
    }

    const unsignedTx = await txBuilder
        .spendingPlutusScriptV3()
        .txIn(
            scriptUtxo.input.txHash,
            scriptUtxo.input.outputIndex,
            scriptUtxo.output.amount,
            scriptUtxo.output.address,
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(redeemer)
        .txInScript(scriptCbor)
        .requiredSignerHash(owner1Hash)       // owner1 signs
        .requiredSignerHash(owner2Hash)       // owner2 signs → 2-of-3 satisfies threshold
        .txOut(changeAddress, scriptUtxo.output.amount)
        .txInCollateral(
            collateral.input.txHash,
            collateral.input.outputIndex,
            collateral.output.amount,
            collateral.output.address,
        )
        .changeAddress(changeAddress)
        .selectUtxosFrom(walletUtxos)
        .complete();

    // owner1 signs first, then owner2 co-signs (partial=true keeps existing sigs)
    const signedByOwner1 = await wallet1.signTx(unsignedTx, true);
    const signedByBoth = await wallet2.signTx(signedByOwner1, true);
    const txHash2 = await wallet1.submitTx(signedByBoth);

    console.log("✅ Unlocked! TX hash:", txHash2);
}

main();
