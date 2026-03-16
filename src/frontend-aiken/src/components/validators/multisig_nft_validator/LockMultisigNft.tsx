"use client"

import { useState } from 'react'
import { BrowserWallet } from '@meshsdk/core'
import { Button } from '@/components/ui/button'
import { lockAssetsToMultiSigNft } from '@/lib/server/validators/multisig_nft_validator/multisig-nft-lock'
import { useEffect } from 'react'

interface LockMultisigNftProps {
    wallet: BrowserWallet | null
    scriptAddr: string
}

export function LockMultisigNft({ wallet, scriptAddr }: LockMultisigNftProps) {
    const [owners, setOwners] = useState<string[]>(['', '', ''])
    const [threshold, setThreshold] = useState<number>(2)
    const [amount, setAmount] = useState<string>('5')
    const [policyId, setPolicyId] = useState<string>('')
    // User-defined token name used on-chain.
    const [tokenName, setTokenName] = useState<string>('MultiSigReceipt')
    const [loading, setLoading] = useState(false)
    const [txHash, setTxHash] = useState<string>('')
    const [error, setError] = useState<string>('')

    useEffect(() => {
        const loadNftPolicyScript = async () => {
            try {
                const response = await fetch('/api/validators')
                if (!response.ok) return

                const data = await response.json()
                const scripts = data?.scripts || []
                const nftPolicy = scripts.find((s: any) =>
                    typeof s?.title === 'string' &&
                    s.title.toLowerCase().startsWith('nft_policy.') &&
                    s.title.toLowerCase().endsWith('.mint')
                )

                if (nftPolicy?.scriptCbor) {
                    setPolicyId((prev) => prev || nftPolicy.scriptCbor)
                }
            } catch (err) {
                console.error('Failed to auto-load NFT policy script:', err)
            }
        }

        loadNftPolicyScript()
    }, [])

    const handleOwnerChange = (index: number, value: string) => {
        const newOwners = [...owners]
        newOwners[index] = value
        setOwners(newOwners)

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

            const validOwnersCount = newOwners.filter(o => o.trim()).length
            if (threshold > validOwnersCount && validOwnersCount > 0) {
                setThreshold(validOwnersCount)
            }
        }
    }

    const handleThresholdChange = (value: number) => {
        const validOwnersCount = owners.filter(o => o.trim()).length
        const maxThreshold = validOwnersCount > 0 ? validOwnersCount : 1

        const newThreshold = Math.max(1, Math.min(value, maxThreshold))
        setThreshold(newThreshold)
    }

    const handleLockAssets = async () => {
        if (!wallet) {
            setError('Please connect your wallet first')
            return
        }

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

        if (!policyId.trim()) {
            setError('Please enter a policy ID')
            return
        }

        if (!tokenName.trim()) {
            setError('Please enter a token name')
            return
        }

        setLoading(true)
        setError('')
        setTxHash('')

        try {
            const assets = [
                { unit: 'lovelace', quantity: (parseFloat(amount) * 1_000_000).toString() }
            ]

            const hash = await lockAssetsToMultiSigNft(
                wallet,
                scriptAddr,
                validOwners,
                threshold,
                assets,
                policyId.trim(),
                tokenName.trim()
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

            <div>
                <label className="text-sm text-gray-400 block mb-2">NFT Policy Script (auto-loaded from nft_policy)</label>
                <input
                    type="text"
                    value={policyId}
                    onChange={(e) => setPolicyId(e.target.value)}
                    placeholder="Plutus V3 minting policy script CBOR (nft_policy.nft_policy.mint)"
                    className="w-full bg-slate-900/50 text-white text-sm p-2 rounded border border-purple-500/10 focus:border-purple-500/40 outline-none font-mono"
                />
            </div>

            <div>
                <label className="text-sm text-gray-400 block mb-2">Receipt Token Name</label>
                <input
                    type="text"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder="MultiSigReceipt"
                    className="w-full bg-slate-900/50 text-white text-sm p-2 rounded border border-purple-500/10 focus:border-purple-500/40 outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                    This token name will be used for minting and burning the receipt NFT.
                </p>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded p-3">
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            )}

            {txHash && (
                <div className="bg-green-500/10 border border-green-500/40 rounded p-3">
                    <p className="text-green-400 text-sm mb-2">✓ Assets locked successfully!</p>
                    <p className="text-xs text-gray-300 mb-1">Receipt Token: {tokenName || 'MultiSigReceipt'}</p>
                    <p className="text-xs text-gray-400 font-mono break-all">Tx: {txHash}</p>
                </div>
            )}

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
