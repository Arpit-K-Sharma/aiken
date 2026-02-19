export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { buildUnlockTransaction } from '@/lib/server/validators/multi_sig_wallet/multi-sig-unlock';
import { getBlockfrostProvider, NETWORK } from '@/lib/config';

/**
 * POST - Build unsigned transaction for unlocking assets
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { scriptAddr, scriptUtxo, scriptCbor, outputAddress } = body;

        // Validate inputs
        if (!scriptAddr || !scriptUtxo || !scriptCbor || !outputAddress) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // NOTE: This API route is unused in the current architecture.
        // Transaction building is done client-side via useMultisig hook.
        // Keeping this for reference/future use.

        return NextResponse.json(
            { error: 'This endpoint is deprecated. Use client-side transaction building.' },
            { status: 501 }
        );
    } catch (error: any) {
        console.error('Unlock API error:', error);
        return NextResponse.json(
            { error: error.message || 'API error' },
            { status: 500 }
        );
    }
}
