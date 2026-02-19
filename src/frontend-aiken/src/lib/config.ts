import { BlockfrostProvider } from "@meshsdk/core";

// Network configuration
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'preprod') as 'mainnet' | 'preprod' | 'preview';
// Client-side: use NEXT_PUBLIC_ prefix, Server-side: use regular env var
export const BLOCKFROST_PROJECT_ID = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID || '';

// Determine network ID (0 for testnet, 1 for mainnet)
export const CARDANO_NETWORK = NETWORK === 'mainnet' ? 1 : 0;

// Blockfrost API URLs
export const BLOCKFROST_API_URL =
    NETWORK === 'mainnet'
        ? 'https://cardano-mainnet.blockfrost.io/api/v0'
        : NETWORK === 'preview'
            ? 'https://cardano-preview.blockfrost.io/api/v0'
            : 'https://cardano-preprod.blockfrost.io/api/v0';

// Create Blockfrost provider instance (singleton)
let blockfrostProvider: BlockfrostProvider | null = null;

export function getBlockfrostProvider(): BlockfrostProvider {
    if (!blockfrostProvider) {
        if (!BLOCKFROST_PROJECT_ID) {
            throw new Error('BLOCKFROST_PROJECT_ID environment variable is not set');
        }
        blockfrostProvider = new BlockfrostProvider(BLOCKFROST_PROJECT_ID);
    }
    return blockfrostProvider;
}

// Legacy export for backward compatibility
const config = {
    cardanoNetwork: CARDANO_NETWORK,
    network: NETWORK,
    blockfrostProjectId: BLOCKFROST_PROJECT_ID,
    blockfrostApiUrl: BLOCKFROST_API_URL,
}

export default config
