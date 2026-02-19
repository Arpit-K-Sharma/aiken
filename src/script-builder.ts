import {
    BlockfrostProvider,
    BrowserWallet,
    MeshTxBuilder,
    serializePlutusScript,
} from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-csl";
import blueprint from "../plutus.json";
import "dotenv/config";


const blockchainProvider = new BlockfrostProvider(process.env.BLOCKFROST_PROJECT_ID || "");



export function getScript(validatorIndex: number = 0) {
    const scriptCbor = applyParamsToScript(
        blueprint.validators[validatorIndex].compiledCode,
        []
    );

    const scriptAddr = serializePlutusScript(
        { code: scriptCbor, version: "V3" },
    ).address;

    return {
        scriptCbor,
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

// Print script CBOR and address for all validators if this file is run directly
if (require.main === module) {
    console.log(`\n=== Found ${blueprint.validators.length} validator(s) in plutus.json ===\n`);

    const uniqueScripts = getAllUniqueScripts();

    uniqueScripts.forEach((script, index) => {
        console.log(`[${index + 1}] Validator: ${script.title}`);
        console.log('─'.repeat(60));
        console.log('Script CBOR:', script.scriptCbor);
        console.log('Script Address:', script.scriptAddr);
        console.log('\n');
    });

    console.log(`Total unique scripts: ${uniqueScripts.length} out of ${blueprint.validators.length} validators\n`);
}

