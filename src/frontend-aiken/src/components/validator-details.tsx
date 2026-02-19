"use client"

import { useState, useEffect } from 'react'
import { BrowserWallet } from '@meshsdk/core'
import type { ValidatorScript } from './validator-selector'
import { LockMultiSig } from './validators/multi-sig-wallet/LockMultiSig'
import { UnlockMultiSig } from './validators/multi-sig-wallet/UnlockMultiSig'
import { LockMultiSigFixed } from './validators/multi-sig-fixed/LockMultiSigFixed'

interface ValidatorDetailsProps {
    validator: ValidatorScript
}

type Tab = 'lock' | 'unlock'

export function ValidatorDetails({ validator }: ValidatorDetailsProps) {
    const [activeTab, setActiveTab] = useState<Tab>('lock')
    const [wallet, setWallet] = useState<BrowserWallet | null>(null)

    useEffect(() => {
        async function loadWallet() {
            try {
                const session = sessionStorage.getItem('walletSession');
                if (session) {
                    const sessionData = JSON.parse(session);
                    if (sessionData.id) {
                        const walletInstance = await BrowserWallet.enable(sessionData.id);
                        setWallet(walletInstance);
                        console.log('Wallet loaded:', sessionData.id);
                    }
                }
            } catch (error) {
                console.error('Failed to enable wallet:', error);
            }
        }
        loadWallet();
    }, []);

    // Dynamically render lock/unlock components based on validator title
    const renderLockComponent = () => {
        // Extract the base validator name (e.g., "multi_sig_wallet.multisig.spend" -> "multi_sig_wallet")
        const validatorName = validator.title.toLowerCase().split('.')[0];

        switch (validatorName) {
            case 'multi_sig_wallet':
                return <LockMultiSig wallet={wallet} scriptAddr={validator.scriptAddr} />

            case 'multi_sig_fixed':
                return <LockMultiSigFixed wallet={wallet} scriptAddr={validator.scriptAddr} />
            default:
                return (
                    <div className="text-center text-gray-400 p-4">
                        <p>Lock component not implemented for this validator.</p>
                        <p className="text-sm mt-2">Create a lock component for: {validator.title}</p>
                    </div>
                )
        }
    }

    const renderUnlockComponent = () => {
        // Extract the base validator name (e.g., "multi_sig_wallet.multisig.spend" -> "multi_sig_wallet")
        const validatorName = validator.title.toLowerCase().split('.')[0];

        switch (validatorName) {
            case 'multi_sig_wallet':
                return (
                    <UnlockMultiSig
                        wallet={wallet}
                        scriptAddr={validator.scriptAddr}
                        scriptCbor={validator.scriptCbor}
                    />
                )
            default:
                return (
                    <div className="text-center text-gray-400 p-4">
                        <p>Unlock component not implemented for this validator.</p>
                        <p className="text-sm mt-2">Create an unlock component for: {validator.title}</p>
                    </div>
                )
        }
    }

    return (
        <div className="bg-slate-800/50 backdrop-blur-sm border border-purple-500/20 rounded-xl p-6 space-y-4">
            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-purple-500/20">
                <button
                    onClick={() => setActiveTab('lock')}
                    className={`px-6 py-2 text-sm font-semibold transition-colors ${activeTab === 'lock'
                        ? 'text-purple-400 border-b-2 border-purple-400'
                        : 'text-gray-400 hover:text-gray-300'
                        }`}
                >
                    Lock Assets
                </button>
                <button
                    onClick={() => setActiveTab('unlock')}
                    className={`px-6 py-2 text-sm font-semibold transition-colors ${activeTab === 'unlock'
                        ? 'text-purple-400 border-b-2 border-purple-400'
                        : 'text-gray-400 hover:text-gray-300'
                        }`}
                >
                    Unlock Assets
                </button>
            </div>

            {/* Validator Info */}
            <div className="space-y-3">
                <div>
                    <label className="text-sm text-gray-400 block mb-2">Validator</label>
                    <div className="bg-slate-900/50 p-3 rounded border border-purple-500/10">
                        <p className="text-white font-semibold text-sm">{validator.title}</p>
                    </div>
                </div>

                <div>
                    <label className="text-sm text-gray-400 block mb-2">Script Address</label>
                    <div className="bg-slate-900/50 p-3 rounded border border-purple-500/10">
                        <p className="text-white font-mono text-xs break-all">
                            {validator.scriptAddr}
                        </p>
                    </div>
                </div>
            </div>

            {/* Dynamic Lock/Unlock Content */}
            {activeTab === 'lock' && renderLockComponent()}
            {activeTab === 'unlock' && renderUnlockComponent()}

            {/* Script CBOR - Collapsible */}
            <details className="group">
                <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
                    View Script CBOR
                </summary>
                <div className="bg-slate-900/50 p-3 rounded border border-purple-500/10 max-h-40 overflow-y-auto mt-2">
                    <p className="text-white font-mono text-xs break-all">
                        {validator.scriptCbor}
                    </p>
                </div>
            </details>
        </div>
    )
}
