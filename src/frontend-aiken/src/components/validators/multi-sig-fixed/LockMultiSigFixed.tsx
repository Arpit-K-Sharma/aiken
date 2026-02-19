"use client"

import { useState, useEffect } from 'react'
import { BrowserWallet } from '@meshsdk/core'
import { Button } from '@/components/ui/button'
import { lockAssetsToMultiSigFixed } from '@/lib/server/validators/multi_sig_fixed/multi-sig-fixed-lock'

interface LockMultiSigProps {
    wallet: BrowserWallet | null
    scriptAddr: string
}

export function LockMultiSigFixed({ wallet, scriptAddr }: LockMultiSigProps) {
    const [owner, setOwner] = useState<string>('')
    const [amount, setAmount] = useState<string>('5')
    const [loading, setLoading] = useState(false)
    const [txHash, setTxHash] = useState<string>('')
    const [error, setError] = useState<string>('')


    useEffect(() => {
    if (!wallet) return;

    const getAddress = async () => {
        const ownerAddr = await wallet.getChangeAddress();
        setOwner(ownerAddr?.toString() || '');
    };

        getAddress();
    }, [wallet]);

    const handleLockAssets = async () => {
        if (!wallet) {
            setError('Please connect your wallet first')
            return
        }


        if (!amount || parseFloat(amount) <= 0) {
            setError('Please enter a valid amount')
            return
        }

        setLoading(true)
        setError('')
        setTxHash('')

        try {
            const assets = [
                { unit: 'lovelace', quantity: (parseFloat(amount) * 1_000_000).toString() }
            ]

            const hash = await lockAssetsToMultiSigFixed(
                wallet,
                scriptAddr,
                owner,
                assets
            )

            setTxHash(hash)
            setError('')
        } catch (err: any) {
            setError(err.message || 'Failed to lock assets')
            console.error('Lock assets error:', err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* Owner Addresses */}
            <div>
                <label className="text-sm text-gray-400 block mb-2">Owner Address</label>
                <div className="bg-slate-900/50 p-3 rounded border border-purple-500/10">
                        <p className="text-white font-mono text-xs break-all">
                            {owner}
                        </p>
                    </div>
                </div>
            {/* Amount */}
            <div>
                <label className="text-sm text-gray-400 block mb-2">Amount (ADA)</label>
                <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-slate-900/50 text-white text-sm p-2 rounded border border-purple-500/10 focus:border-purple-500/40 outline-none"
                />
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded p-3">
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            )}

            {/* Success Message */}
            {txHash && (
                <div className="bg-green-500/10 border border-green-500/40 rounded p-3">
                    <p className="text-green-400 text-sm mb-2">✓ Assets locked successfully!</p>
                    <p className="text-xs text-gray-400 font-mono break-all">Tx: {txHash}</p>
                </div>
            )}

            {/* Lock Button */}
            <div className="pt-4">
                <Button
                    className="w-full border-2 border-purple-500 cursor-pointer"
                    onClick={handleLockAssets}
                    disabled={loading || !wallet}
                >
                    {loading ? 'Locking Assets...' : !wallet ? 'Connect Wallet First' : 'Lock Assets'}
                </Button>
            </div>
        </div>
    )
}
