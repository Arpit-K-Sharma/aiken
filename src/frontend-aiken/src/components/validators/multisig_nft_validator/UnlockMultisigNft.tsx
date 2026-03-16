"use client"

import { useState, useEffect } from 'react'
import { BrowserWallet, UTxO } from '@meshsdk/core'
import { Button } from '@/components/ui/button'
import {
    parseDatum,
    initiateUnlock,
    exportSessionPayload,
} from '@/lib/server/validators/multisig_nft_validator/multisig-nft-unlock'
import { addressToKeyHashAsync } from '@/lib/addressToKeyHash'
import { useMultiSig, formatCountdown } from '@/components/validators/multi-sig-wallet/hooks/useMultisig'
import { getBlockfrostProvider, NETWORK } from '@/lib/config'

interface UnlockMultisigNftProps {
    wallet: BrowserWallet | null
    scriptAddr: string
    scriptCbor: string
    onUtxosRefresh?: () => void
}

export function UnlockMultisigNft({ wallet, scriptAddr, scriptCbor, onUtxosRefresh }: UnlockMultisigNftProps) {
    const [scriptUtxos, setScriptUtxos] = useState<UTxO[]>([])
    const [selectedUtxo, setSelectedUtxo] = useState<UTxO | null>(null)
    const [outputAddress, setOutputAddress] = useState<string>('')
    const [fetchingUtxos, setFetchingUtxos] = useState(false)
    const [currentWalletKeyHash, setCurrentWalletKeyHash] = useState<string>('')
    const [datumOwners, setDatumOwners] = useState<string[]>([])
    const [datumThreshold, setDatumThreshold] = useState<number>(0)
    const [selectedSigners, setSelectedSigners] = useState<Set<string>>(new Set())
    const [ownerAddresses, setOwnerAddresses] = useState<Record<string, string>>({})
    const [policyId, setPolicyId] = useState<string>('')
    // User-defined token name used on-chain.
    const [tokenName, setTokenName] = useState<string>('MultiSigReceipt')
    const [initiating, setInitiating] = useState(false)
    const [localError, setLocalError] = useState<string>('')

    const multiSig = useMultiSig()

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

    useEffect(() => {
        const updateWalletKeyHash = async () => {
            if (wallet) {
                try {
                    const walletAddress = await wallet.getChangeAddress()
                    const keyHash = await addressToKeyHashAsync(walletAddress)
                    setCurrentWalletKeyHash(keyHash)
                    if (!outputAddress && !multiSig.session) {
                        setOutputAddress(walletAddress)
                    }
                } catch (err) {
                    console.error('Failed to get wallet key hash:', err)
                }
            } else {
                setCurrentWalletKeyHash('')
            }
        }
        updateWalletKeyHash()
    }, [wallet])

    useEffect(() => {
        const loadDatum = async () => {
            if (!selectedUtxo) {
                setDatumOwners([])
                setDatumThreshold(0)
                setSelectedSigners(new Set())
                return
            }
            try {
                const { owners, threshold } = await parseDatum(selectedUtxo)
                const uniqueOwners = [...new Set(owners)]
                setDatumOwners(uniqueOwners)
                setDatumThreshold(threshold)
                const addrMap: Record<string, string> = {}
                for (const pkh of uniqueOwners) {
                    const shortened = pkh.length > 20 ? `${pkh.slice(0, 8)}...${pkh.slice(-8)}` : pkh
                    addrMap[pkh] = `Key: ${shortened}`
                }
                setOwnerAddresses(addrMap)
                const autoSelected = new Set<string>()
                if (currentWalletKeyHash && uniqueOwners.includes(currentWalletKeyHash)) {
                    autoSelected.add(currentWalletKeyHash)
                }
                for (const o of uniqueOwners) {
                    if (autoSelected.size >= threshold) break
                    autoSelected.add(o)
                }
                setSelectedSigners(autoSelected)
            } catch (err) {
                console.error('Failed to parse datum:', err)
            }
        }
        loadDatum()
    }, [selectedUtxo, currentWalletKeyHash])

    const fetchScriptUtxos = async () => {
        setFetchingUtxos(true)
        try {
            const response = await fetch(`/api/utxos/${scriptAddr}`)
            if (!response.ok) {
                throw new Error('Failed to fetch UTxOs')
            }
            const data = await response.json()
            setScriptUtxos(data.utxos || [])
        } catch (err: any) {
            console.error('Fetch UTxOs error:', err)
        } finally {
            setFetchingUtxos(false)
        }
    }

    const handleInitiateUnlock = async () => {
        if (!wallet || !selectedUtxo || !outputAddress) {
            return
        }

        setLocalError('')
        setInitiating(true)
        try {
            if (currentWalletKeyHash && !datumOwners.includes(currentWalletKeyHash)) {
                throw new Error('Current wallet is not an owner of this multi-sig')
            }

            const signingOwners = Array.from(selectedSigners)
            if (signingOwners.length < datumThreshold) {
                throw new Error(`Select at least ${datumThreshold} signing owners (currently ${signingOwners.length} selected).`)
            }

            if (!policyId.trim()) {
                throw new Error('Policy ID is required to burn the receipt NFT during unlock.')
            }

            if (!tokenName.trim()) {
                throw new Error('Token Name is required to burn the receipt NFT during unlock.')
            }

            const provider = getBlockfrostProvider()
            const network = NETWORK as 'mainnet' | 'preprod' | 'preview'

            await initiateUnlock(
                wallet,
                provider,
                scriptAddr,
                selectedUtxo,
                scriptCbor,
                outputAddress,
                network,
                signingOwners,
                policyId.trim(),
                tokenName.trim()
            )

            const payload = exportSessionPayload()
            if (payload) {
                // Reuse useMultiSig state machine/session UI by syncing from shared session storage.
                multiSig.loadFromPayload(payload)
            }
        } catch (err: any) {
            setLocalError(err?.message || 'Failed to initiate unlock')
            console.error('Initiate unlock error:', err)
        } finally {
            setInitiating(false)
        }
    }

    const handleCoSign = async () => {
        if (!wallet) return
        try {
            await multiSig.cosign(wallet)
        } catch (err) {
            console.error('Co-sign error:', err)
        }
    }

    const handleSubmit = async () => {
        if (!wallet) return
        try {
            await multiSig.submit(wallet)

            setTimeout(() => {
                fetchScriptUtxos()
                if (onUtxosRefresh) onUtxosRefresh()
                setSelectedUtxo(null)
                setOutputAddress('')
            }, 3000)
        } catch (err) {
            console.error('Submit error:', err)
        }
    }

    const currentWalletHasSigned = multiSig.session?.collectedSigners.includes(currentWalletKeyHash) || false

    return (
        <div className="space-y-4">
            <div>
                <Button
                    onClick={fetchScriptUtxos}
                    disabled={fetchingUtxos || !wallet}
                    className="w-full border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20"
                >
                    {fetchingUtxos ? 'Fetching UTxOs...' : 'Refresh Locked UTxOs'}
                </Button>
            </div>

            {scriptUtxos.length > 0 ? (
                <div className="space-y-2">
                    <label className="text-sm text-gray-400 block">Select UTxO to Unlock</label>
                    {scriptUtxos.map((utxo) => {
                        const lovelaceAmount = utxo.output.amount.find((a: any) => a.unit === 'lovelace')
                        const adaAmount = lovelaceAmount ? (parseInt(lovelaceAmount.quantity) / 1_000_000).toFixed(2) : '0'
                        const isSelected = selectedUtxo?.input.txHash === utxo.input.txHash &&
                            selectedUtxo?.input.outputIndex === utxo.input.outputIndex

                        return (
                            <div
                                key={`${utxo.input.txHash}#${utxo.input.outputIndex}`}
                                onClick={() => setSelectedUtxo(utxo)}
                                className={`p-3 rounded border cursor-pointer transition-colors ${isSelected
                                    ? 'border-purple-500 bg-purple-500/10'
                                    : 'border-purple-500/20 hover:border-purple-500/40 bg-slate-900/30'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <div>
                                        <p className="text-white text-sm font-medium">{adaAmount} ADA</p>
                                        <p className="text-gray-400 text-xs font-mono truncate max-w-xs">
                                            {utxo.input.txHash}#{utxo.input.outputIndex}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <span className="text-purple-400 text-xs">✓ Selected</span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="bg-slate-900/30 border border-purple-500/10 rounded p-4 text-center">
                    <p className="text-gray-400 text-sm">
                        {fetchingUtxos ? 'Loading...' : 'No locked UTxOs found. Lock some assets first.'}
                    </p>
                </div>
            )}

            {!multiSig.session && selectedUtxo && (
                <div className="space-y-2">
                    <label className="text-sm text-gray-400 block">Output Address (where to send unlocked funds)</label>
                    <input
                        type="text"
                        value={outputAddress}
                        onChange={(e) => setOutputAddress(e.target.value)}
                        placeholder="addr1..."
                        className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/20 rounded text-white text-sm font-mono focus:outline-none focus:border-purple-500/60"
                    />
                    <p className="text-xs text-gray-500">Defaults to your wallet address. Can be changed to any valid address.</p>
                </div>
            )}

            {!multiSig.session && selectedUtxo && (
                <div className="space-y-2">
                    <label className="text-sm text-gray-400 block">NFT Policy Script (auto-loaded from nft_policy)</label>
                    <input
                        type="text"
                        value={policyId}
                        onChange={(e) => setPolicyId(e.target.value)}
                        placeholder="Plutus V3 minting policy script CBOR (nft_policy.nft_policy.mint)"
                        className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/20 rounded text-white text-sm font-mono focus:outline-none focus:border-purple-500/60"
                    />
                </div>
            )}

            {!multiSig.session && selectedUtxo && (
                <div className="space-y-2">
                    <label className="text-sm text-gray-400 block">Receipt Token Name</label>
                    <input
                        type="text"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        placeholder="MultiSigReceipt"
                        className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/20 rounded text-white text-sm focus:outline-none focus:border-purple-500/60"
                    />
                    <p className="text-xs text-gray-500">
                        Use the same token name used during lock so burn can match the receipt NFT.
                    </p>
                </div>
            )}

            {!multiSig.session && selectedUtxo && datumOwners.length > 0 && (
                <div className="space-y-2">
                    <label className="text-sm text-gray-400 block">
                        Select Signing Owners
                        <span className="ml-2 text-xs text-yellow-400">(need {datumThreshold} of {datumOwners.length})</span>
                    </label>
                    <p className="text-xs text-gray-500">Only select owners who will actually sign. Every selected owner MUST provide a signature or the transaction will fail.</p>
                    <div className="space-y-1">
                        {datumOwners.map((pkh) => {
                            const isCurrentWallet = pkh === currentWalletKeyHash
                            const isChecked = selectedSigners.has(pkh)
                            return (
                                <label
                                    key={pkh}
                                    className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${isChecked
                                        ? 'border-purple-500/60 bg-purple-500/10'
                                        : 'border-purple-500/20 hover:border-purple-500/40'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => {
                                            const next = new Set(selectedSigners)
                                            if (e.target.checked) next.add(pkh)
                                            else next.delete(pkh)
                                            setSelectedSigners(next)
                                        }}
                                        className="accent-purple-500"
                                    />
                                    <span className="text-xs font-mono text-gray-300 truncate">{ownerAddresses[pkh] ?? pkh}</span>
                                    {isCurrentWallet && (
                                        <span className="text-xs text-purple-400 shrink-0">← you</span>
                                    )}
                                </label>
                            )
                        })}
                    </div>
                    {selectedSigners.size < datumThreshold && (
                        <p className="text-xs text-red-400">Select at least {datumThreshold} owners.</p>
                    )}
                </div>
            )}

            {(localError || multiSig.error) && (
                <div className="bg-red-500/10 border border-red-500/40 rounded p-3">
                    <p className="text-red-400 text-sm">{localError || multiSig.error}</p>
                </div>
            )}

            {multiSig.step === 'submitted' && multiSig.txHash && (
                <div className="bg-green-500/10 border border-green-500/40 rounded p-3">
                    <p className="text-green-400 text-sm mb-2">✓ Transaction submitted successfully!</p>
                    <p className="text-xs text-gray-300 mb-1">Receipt Token: {tokenName || 'MultiSigReceipt'}</p>
                    <p className="text-xs text-gray-400 font-mono break-all">Tx: {multiSig.txHash}</p>
                    <Button
                        onClick={() => {
                            multiSig.reset()
                            setSelectedUtxo(null)
                            setOutputAddress('')
                        }}
                        className="mt-3 w-full bg-green-500/20 hover:bg-green-500/30"
                    >
                        Start New Unlock
                    </Button>
                </div>
            )}

            {multiSig.step === 'expired' && (
                <div className="bg-orange-500/10 border border-orange-500/40 rounded p-3">
                    <p className="text-orange-400 text-sm">⏰ Session expired. Please start a new unlock session.</p>
                    <Button
                        onClick={multiSig.reset}
                        className="mt-2 w-full bg-orange-500/20 hover:bg-orange-500/30"
                    >
                        Clear & Start New
                    </Button>
                </div>
            )}

            {multiSig.session && multiSig.step !== 'submitted' && multiSig.step !== 'expired' && (
                <div className="bg-blue-500/10 border border-blue-500/40 rounded p-4 space-y-3">
                    <div>
                        <p className="text-blue-400 text-sm font-semibold mb-1">
                            🔐 Multi-Sig Session Active
                        </p>
                        <p className="text-xs text-gray-400 mb-2">
                            Session ID: <span className="font-mono">{multiSig.session.sessionId.slice(0, 8)}...</span>
                        </p>
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <span className="text-xs text-gray-400">Signatures Collected</span>
                            <span className="text-xs text-white font-semibold">
                                {multiSig.signed} of {multiSig.required}
                            </span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
                            <div
                                className="bg-green-500 h-2 rounded-full transition-all"
                                style={{ width: `${(multiSig.signed / multiSig.required) * 100}%` }}
                            />
                        </div>
                    </div>

                    {multiSig.remainingMs > 0 && (
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">Expires in:</span>
                            <span className="text-yellow-400 font-mono">{formatCountdown(multiSig.remainingMs)}</span>
                        </div>
                    )}

                    {wallet && (
                        <div className="pt-2 border-t border-blue-500/20">
                            {currentWalletHasSigned ? (
                                <p className="text-green-400 text-xs flex items-center gap-1">
                                    <span>✓</span> Current wallet has signed
                                </p>
                            ) : (
                                <p className="text-gray-400 text-xs flex items-center gap-1">
                                    <span>ℹ</span> Current wallet has not signed yet
                                </p>
                            )}
                        </div>
                    )}

                    <div>
                        <p className="text-xs text-gray-400 mb-2">Collected Signers:</p>
                        <div className="space-y-1">
                            {multiSig.session.collectedSigners.map((pkh, index) => (
                                <div key={index} className="bg-green-500/10 border border-green-500/30 px-2 py-1 rounded text-xs">
                                    <span className="text-green-400">✓</span> <span className="text-gray-400 font-mono">{pkh.slice(0, 16)}...</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2 pt-2">
                        {wallet && !currentWalletHasSigned && (multiSig.step === 'pending' || multiSig.step === 'cosigning') && (
                            <Button
                                onClick={handleCoSign}
                                disabled={multiSig.step === 'cosigning'}
                                className="w-full bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40"
                            >
                                {multiSig.step === 'cosigning' ? '⏳ Signing...' : '✍️ Co-Sign with Current Wallet'}
                            </Button>
                        )}
                        {(multiSig.step === 'ready' || multiSig.step === 'submitting') && (
                            <Button
                                onClick={handleSubmit}
                                disabled={multiSig.step === 'submitting' || !wallet}
                                className="w-full bg-green-500/20 hover:bg-green-500/30 border border-green-500/40"
                            >
                                {multiSig.step === 'submitting' ? '⏳ Submitting...' : '🚀 Submit Transaction'}
                            </Button>
                        )}
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-blue-500/20">
                        {multiSig.sharePayload && (
                            <Button
                                onClick={multiSig.copySharePayload}
                                className="flex-1 text-xs bg-slate-700/50 hover:bg-slate-600/50 border border-slate-500/40"
                            >
                                📋 Copy Session
                            </Button>
                        )}
                        <Button
                            onClick={multiSig.reset}
                            className="flex-1 text-xs bg-red-500/20 hover:bg-red-500/30 border border-red-500/40"
                        >
                            Clear Session
                        </Button>
                    </div>
                </div>
            )}

            {!multiSig.session && (multiSig.step === 'idle' || multiSig.step === 'building') && selectedUtxo && outputAddress && (
                <div>
                    <Button
                        className="w-full border-2 border-purple-500 bg-purple-500/10 hover:bg-purple-500/20"
                        onClick={handleInitiateUnlock}
                        disabled={initiating || !wallet}
                    >
                        {initiating
                            ? '⏳ Building Transaction...'
                            : !wallet
                                ? 'Connect Wallet First'
                                : '🔓 Initiate Unlock & Sign'}
                    </Button>
                </div>
            )}

            <p className="text-xs text-gray-500 text-center">
                {multiSig.session
                    ? 'Switch wallets to collect additional signatures from other owners.'
                    : selectedUtxo && outputAddress
                        ? 'Click the button above to initiate the unlock and sign with your wallet.'
                        : 'Select a UTxO and enter an output address to begin.'}
            </p>
        </div>
    )
}
