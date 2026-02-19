// Dynamic CSL import to avoid loading WASM at module init (prevents memory issues)
let CSL: typeof import("@emurgo/cardano-serialization-lib-browser") | null = null;

export async function getCSL() {
    if (!CSL) {
        CSL = await import("@emurgo/cardano-serialization-lib-browser");
    }
    return CSL;
}

/**
 * Convert Bech32 address to verification key hash
 * @param bech32Address - Address in bech32 format (addr_test1... or addr1...)
 * @returns Key hash as hex string
 */
export function addressToKeyHash(bech32Address: string): string {
    // Synchronous version - only use after CSL is loaded
    if (!CSL) {
        throw new Error("CSL not loaded. Call getCSL() first or use addressToKeyHashAsync().");
    }

    // Convert bech32 address to Address object
    const address = CSL.Address.from_bech32(bech32Address);

    // Get base address
    const baseAddress = CSL.BaseAddress.from_address(address);

    if (!baseAddress) {
        throw new Error(`Invalid base address: ${bech32Address}`);
    }

    // Extract payment credential
    const paymentCred = baseAddress.payment_cred();

    // Get key hash
    const keyHash = paymentCred.to_keyhash();

    if (!keyHash) {
        throw new Error(`Address does not contain a key hash: ${bech32Address}`);
    }

    return keyHash.to_hex();
}

/**
 * Async version of addressToKeyHash for initial loads
 */
export async function addressToKeyHashAsync(bech32Address: string): Promise<string> {
    const csl = await getCSL();
    const address = csl.Address.from_bech32(bech32Address);
    const baseAddress = csl.BaseAddress.from_address(address);

    if (!baseAddress) {
        throw new Error(`Invalid base address: ${bech32Address}`);
    }

    const paymentCred = baseAddress.payment_cred();
    const keyHash = paymentCred.to_keyhash();

    if (!keyHash) {
        throw new Error(`Address does not contain a key hash: ${bech32Address}`);
    }

    return keyHash.to_hex();
}