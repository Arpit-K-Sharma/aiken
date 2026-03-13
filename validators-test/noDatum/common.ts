import {
    BlockfrostProvider,
    MeshTxBuilder,
    serializePlutusScript,
} from '@meshsdk/core';
import { applyParamsToScript } from '@meshsdk/core-csl';
import "dotenv/config"
import blueprint from "../../plutus.json"

const BLOCKFROST_API_KEY = process.env.BLOCKFROST_PROJECT_ID || '';

// Your plutus.json validator - you'll need to import this
let blockchainProvider: BlockfrostProvider | null = null;

export function getBlockchainProvider() {
    if (!blockchainProvider) {
        blockchainProvider = new BlockfrostProvider(BLOCKFROST_API_KEY);
    }
    return blockchainProvider;
}

export function getScript(
    owner1Hash: string,
    owner2Hash: string,
    owner3Hash: string
) {
    const scriptCbor = applyParamsToScript(
        blueprint.validators[4].compiledCode,
        [owner1Hash, owner2Hash, owner3Hash]
    );


    const scriptAddr = serializePlutusScript({
        code: scriptCbor,
        version: 'V3',
    }).address;
 
    return { scriptCbor, scriptAddr };
}

export function getTxBuilder() {
    const provider = getBlockchainProvider();
    console.log('Using Blockfrost provider with project ID:', BLOCKFROST_API_KEY);
    return new MeshTxBuilder({
        fetcher: provider,
        submitter: provider,
    });
}