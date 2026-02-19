"use client"

import { useState } from 'react'
import { BrowserWallet } from '@meshsdk/core'
import { Button } from '@/components/ui/button'
import { lockAssetsToMultiSig } from '@/lib/server/validators/multi_sig_wallet/multi-sig-lock'

interface LockMultiSigProps {
    wallet: BrowserWallet | null
    scriptAddr: string
}

export function LockMultiSig({ wallet, scriptAddr }: LockMultiSigProps) {
    const [owners, setOwners] = useState<string[]>(['', '', ''])
    const [threshold, setThreshold] = useState<number>(2)
    const [amount, setAmount] = useState<string>('5')
    const [loading, setLoading] = useState(false)
    const [txHash, setTxHash] = useState<string>('')
    const [error, setError] = useState<string>('')

    const handleOwnerChange = (index: number, value: string) => {
        const newOwners = [...owners]
        newOwners[index] = value
        setOwners(newOwners)

        // Adjust threshold if it exceeds the number of valid owners
        const validOwnersCount = newOwners.filter(o => o.trim()).length
        if (threshold > validOwnersCount && validOwnersCount > 0) {
            setThreshold(validOwnersCount)
        }
    }

    const addOwner = () => {
        setOwners([...owners, ''])
    }

    const removeOwner = (index: number) => {
        if (owners.length > 1) {
            const newOwners = owners.filter((_, i) => i !== index)
            setOwners(newOwners)

            // Adjust threshold if it exceeds the number of remaining valid owners
            const validOwnersCount = newOwners.filter(o => o.trim()).length
            if (threshold > validOwnersCount && validOwnersCount > 0) {
                setThreshold(validOwnersCount)
            }
        }
    }

    const handleThresholdChange = (value: number) => {
        const validOwnersCount = owners.filter(o => o.trim()).length
        const maxThreshold = validOwnersCount > 0 ? validOwnersCount : 1

        // Clamp threshold between 1 and valid owners count
        const newThreshold = Math.max(1, Math.min(value, maxThreshold))
        setThreshold(newThreshold)
    }

    const handleLockAssets = async () => {
        if (!wallet) {
            setError('Please connect your wallet first')
            return
        }

        // Validate inputs
        const validOwners = owners.filter(addr => addr.trim() !== '')
        if (validOwners.length === 0) {
            setError('Please add at least one owner address')
            return
        }

        if (threshold < 1 || threshold > validOwners.length) {
            setError(`Threshold must be between 1 and ${validOwners.length}`)
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

            const hash = await lockAssetsToMultiSig(
                wallet,
                scriptAddr,
                validOwners,
                threshold,
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
            <div className="space-y-2">
                <label className="text-sm text-gray-400 block">Owner Addresses</label>
                {owners.map((owner, index) => (
                    <div key={index} className="flex gap-2">
                        <input
                            type="text"
                            value={owner}
                            onChange={(e) => handleOwnerChange(index, e.target.value)}
                            placeholder={`Owner ${index + 1} address (addr_test1...)`}
                            className="flex-1 bg-slate-900/50 text-white text-sm p-2 rounded border border-purple-500/10 focus:border-purple-500/40 outline-none font-mono"
                        />
                        {owners.length > 1 && (
                            <Button
                                onClick={() => removeOwner(index)}
                                className="px-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40"
                            >
                                ✕
                            </Button>
                        )}
                    </div>
                ))}
                <Button
                    onClick={addOwner}
                    className="w-full border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20"
                >
                    + Add Owner
                </Button>
            </div>

            {/* Threshold */}
            <div>
                <label className="text-sm text-gray-400 block mb-2">
                    Threshold (signatures required)
                </label>
                <input
                    type="number"
                    min="1"
                    max={owners.filter(o => o.trim()).length || 1}
                    value={threshold}
                    onChange={(e) => handleThresholdChange(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-900/50 text-white text-sm p-2 rounded border border-purple-500/10 focus:border-purple-500/40 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                    {threshold} of {owners.filter(o => o.trim()).length} signatures needed to unlock
                </p>
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
