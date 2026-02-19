import {
    BlockfrostProvider,
    BrowserWallet,
    MeshTxBuilder,
    serializePlutusScript,
} from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import { toScriptRef } from "@meshsdk/core-csl";
import blueprint from "../../../../../plutus.json";
import { getBlockfrostProvider, NETWORK } from "../config";
import { bech32 } from "bech32";

const blockchainProvider = getBlockfrostProvider();



export function getScript(validatorIndex: number = 0) {
    const compiledCode = blueprint.validators[validatorIndex].compiledCode;
    const networkId = NETWORK === "mainnet" ? 1 : 0;

    // serializePlutusScript uses blake2b(03+flat_bytes) — WRONG for PlutusV3
    // Cardano node uses blake2b(03+compiledCode_bytes) for the script hash
    // So compute the address manually from the correct hash in plutus.json
    const scriptHash = blueprint.validators[validatorIndex].hash; // already correct
    const hashBytes = Buffer.from(scriptHash, "hex");
    // Enterprise script address: header 0x70 (mainnet) or 0x71 (testnet) + scriptHash
    const headerByte = networkId === 1 ? 0x71 : 0x70;
    const addrBytes = Buffer.concat([Buffer.from([headerByte]), hashBytes]);
    const words = bech32.toWords(addrBytes);
    const hrp = networkId === 1 ? "addr" : "addr_test";
    const scriptAddr = bech32.encode(hrp, words, 1000);

    // txInScript needs doubleEncoded so after MeshJS strips one CBOR layer,
    // witness contains compiledCode → node hashes blake2b(03+compiledCode) = scriptHash ✅
    const byteLength = compiledCode.length / 2;
    const doubleEncoded = "59" + byteLength.toString(16).padStart(4, "0") + compiledCode;


    return {
        scriptCbor: doubleEncoded,
        scriptAddr,
        title: blueprint.validators[validatorIndex].title
    };
}

export function getAllUniqueScripts() {
    const seenCbor = new Set<string>();
    const uniqueScripts: Array<{
        scriptCbor: string;
        scriptAddr: string;
        title: string;
    }> = [];

    blueprint.validators.forEach((validator, index) => {
        try {
            const { scriptCbor, scriptAddr, title } = getScript(index);



            // Only add if we haven't seen this CBOR before
            if (!seenCbor.has(scriptCbor)) {
                seenCbor.add(scriptCbor);
                uniqueScripts.push({ scriptCbor, scriptAddr, title });
            }
        } catch (error) {
            console.error(`Error processing validator ${validator.title}:`, error);
        }
    });

    return uniqueScripts;
}

// reusable function to get a transaction builder
export function getTxBuilder() {
    return new MeshTxBuilder({
        fetcher: blockchainProvider,
        submitter: blockchainProvider,
    });
}

// reusable function to get a UTxO by transaction hash
export async function getUtxoByTxHash(txHash: string): Promise<UTxO> {
    const utxos = await blockchainProvider.fetchUTxOs(txHash);
    if (utxos.length === 0) {
        throw new Error("UTxO not found");
    }
    return utxos[0];
}

export { blockchainProvider };
