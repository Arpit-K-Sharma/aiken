
// Types and browser helpers for validator scripts
// For SSR, use the /api/validators API route to fetch validator data

export interface ValidatorScript {
    scriptCbor: string;
    scriptAddr: string;
    title: string;
    hash?: string;
}
