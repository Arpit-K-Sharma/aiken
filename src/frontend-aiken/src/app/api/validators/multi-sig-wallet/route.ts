export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { buildLockTransaction } from '@/lib/server/validators/multi_sig_wallet/multi-sig-lock';

/**
 * POST - Build unsigned transaction for locking assets
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { scriptAddr, owners, threshold, assets, walletAddress, walletUtxos } = body;

        // Validate inputs
        if (!scriptAddr || !owners || !threshold || !assets || !walletAddress || !walletUtxos) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        if (!Array.isArray(owners) || owners.length === 0) {
            return NextResponse.json(
                { error: 'Owners must be a non-empty array' },
                { status: 400 }
            );
        }

        if (threshold < 1 || threshold > owners.length) {
            return NextResponse.json(
                { error: 'Invalid threshold value' },
                { status: 400 }
            );
        }

        // Build unsigned transaction
        const unsignedTx = await buildLockTransaction(
            scriptAddr,
            owners,
            threshold,
            assets,
            walletAddress,
            walletUtxos
        );

        return NextResponse.json({
            success: true,
            unsignedTx,
        });
    } catch (error: any) {
        console.error('Lock transaction build error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to build lock transaction' },
            { status: 500 }
        );
    }
}
