export const runtime = "nodejs";

import { NextRequest, NextResponse } from 'next/server';

// In-memory storage for signature sessions
// In production, use Redis or a database
interface SignatureSession {
    txHash: string;
    unsignedTx: string;
    scriptAddr: string;
    utxoRef: string;
    requiredSignatures: number;
    signatures: {
        signerAddress: string;
        signature: string;
        timestamp: number;
    }[];
    createdAt: number;
    expiresAt: number;
}

const signatureSessions = new Map<string, SignatureSession>();

// TTL for signature sessions (10 minutes)
const SESSION_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of signatureSessions.entries()) {
        if (session.expiresAt < now) {
            signatureSessions.delete(sessionId);
            console.log(`Cleaned up expired session: ${sessionId}`);
        }
    }
}

// Run cleanup every minute
setInterval(cleanupExpiredSessions, 60 * 1000);

/**
 * POST - Create a new signature session or add a signature to an existing session
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sessionId, action, data } = body;

        if (action === 'create') {
            // Create a new signature session
            const { unsignedTx, scriptAddr, utxoRef, requiredSignatures } = data;

            if (!unsignedTx || !scriptAddr || !utxoRef || !requiredSignatures) {
                return NextResponse.json(
                    { error: 'Missing required fields' },
                    { status: 400 }
                );
            }

            const newSessionId = `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = Date.now();

            const session: SignatureSession = {
                txHash: '',
                unsignedTx,
                scriptAddr,
                utxoRef,
                requiredSignatures,
                signatures: [],
                createdAt: now,
                expiresAt: now + SESSION_TTL,
            };

            signatureSessions.set(newSessionId, session);

            return NextResponse.json({
                success: true,
                sessionId: newSessionId,
                expiresIn: SESSION_TTL,
            });
        } else if (action === 'sign') {
            // Add a signature to an existing session
            const { signerAddress, signature } = data;

            if (!sessionId || !signerAddress || !signature) {
                return NextResponse.json(
                    { error: 'Missing required fields' },
                    { status: 400 }
                );
            }

            const session = signatureSessions.get(sessionId);

            if (!session) {
                return NextResponse.json(
                    { error: 'Session not found or expired' },
                    { status: 404 }
                );
            }

            // Check if session is expired
            if (session.expiresAt < Date.now()) {
                signatureSessions.delete(sessionId);
                return NextResponse.json(
                    { error: 'Session expired' },
                    { status: 410 }
                );
            }

            // Check if this signer already signed
            const existingSignature = session.signatures.find(
                s => s.signerAddress === signerAddress
            );

            if (existingSignature) {
                // Update existing signature
                existingSignature.signature = signature;
                existingSignature.timestamp = Date.now();
            } else {
                // Add new signature
                session.signatures.push({
                    signerAddress,
                    signature,
                    timestamp: Date.now(),
                });
            }

            const isComplete = session.signatures.length >= session.requiredSignatures;

            return NextResponse.json({
                success: true,
                sessionId,
                signaturesCollected: session.signatures.length,
                requiredSignatures: session.requiredSignatures,
                isComplete,
            });
        } else {
            return NextResponse.json(
                { error: 'Invalid action' },
                { status: 400 }
            );
        }
    } catch (error) {
        console.error('Signature session error:', error);
        return NextResponse.json(
            { error: String(error) },
            { status: 500 }
        );
    }
}

/**
 * GET - Retrieve a signature session
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Session ID required' },
                { status: 400 }
            );
        }

        const session = signatureSessions.get(sessionId);

        if (!session) {
            return NextResponse.json(
                { error: 'Session not found or expired' },
                { status: 404 }
            );
        }

        // Check if session is expired
        if (session.expiresAt < Date.now()) {
            signatureSessions.delete(sessionId);
            return NextResponse.json(
                { error: 'Session expired' },
                { status: 410 }
            );
        }

        return NextResponse.json({
            success: true,
            session: {
                sessionId,
                unsignedTx: session.unsignedTx,
                scriptAddr: session.scriptAddr,
                utxoRef: session.utxoRef,
                requiredSignatures: session.requiredSignatures,
                signaturesCollected: session.signatures.length,
                signatures: session.signatures.map(s => ({
                    signerAddress: s.signerAddress,
                    timestamp: s.timestamp,
                })),
                createdAt: session.createdAt,
                expiresAt: session.expiresAt,
                isComplete: session.signatures.length >= session.requiredSignatures,
            },
        });
    } catch (error) {
        console.error('Get signature session error:', error);
        return NextResponse.json(
            { error: String(error) },
            { status: 500 }
        );
    }
}

/**
 * DELETE - Remove a signature session (after successful unlock or cancellation)
 */
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Session ID required' },
                { status: 400 }
            );
        }

        const session = signatureSessions.get(sessionId);

        if (!session) {
            return NextResponse.json(
                { error: 'Session not found' },
                { status: 404 }
            );
        }

        signatureSessions.delete(sessionId);

        return NextResponse.json({
            success: true,
            message: 'Session deleted successfully',
        });
    } catch (error) {
        console.error('Delete signature session error:', error);
        return NextResponse.json(
            { error: String(error) },
            { status: 500 }
        );
    }
}
