export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';
import { BLOCKFROST_PROJECT_ID, NETWORK, BLOCKFROST_API_URL } from '@/lib/config';

/**
 * GET - Fetch UTxOs at a specific address
 * This is a proxy endpoint that will use Blockfrost or another provider
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ address: string }> }
) {
    try {
        const { address } = await params;

        if (!address) {
            return NextResponse.json(
                { error: 'Address required' },
                { status: 400 }
            );
        }

        // Check if Blockfrost Project ID is configured
        if (!BLOCKFROST_PROJECT_ID) {
            return NextResponse.json(
                { error: 'Blockfrost Project ID not configured' },
                { status: 500 }
            );
        }

        // Fetch UTxOs from Blockfrost
        const response = await fetch(
            `${BLOCKFROST_API_URL}/addresses/${address}/utxos`,
            {
                headers: {
                    project_id: BLOCKFROST_PROJECT_ID,
                },
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error('Blockfrost error:', error);

            // 404 means address hasn't been used yet - return empty array
            if (response.status === 404) {
                return NextResponse.json({
                    success: true,
                    utxos: [],
                    message: 'Address has no UTxOs (not yet funded or used on this network)',
                });
            }

            return NextResponse.json(
                { error: 'Failed to fetch UTxOs from blockchain' },
                { status: response.status }
            );
        }

        const utxos = await response.json();

        // Transform Blockfrost UTxO format to Mesh format
        const transformedUtxos = utxos.map((utxo: any) => ({
            input: {
                txHash: utxo.tx_hash,
                outputIndex: utxo.output_index,
            },
            output: {
                address: address,
                amount: utxo.amount.map((asset: any) => ({
                    unit: asset.unit,
                    quantity: asset.quantity,
                })),
                dataHash: utxo.data_hash,
                plutusData: utxo.inline_datum,
                scriptRef: utxo.reference_script_hash,
            },
        }));

        return NextResponse.json({
            success: true,
            utxos: transformedUtxos,
        });
    } catch (error) {
        console.error('Fetch UTxOs error:', error);
        return NextResponse.json(
            { error: String(error) },
            { status: 500 }
        );
    }
}
