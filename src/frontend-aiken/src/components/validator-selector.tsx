"use client"

import { useState, useEffect } from 'react'
import { Card } from './ui/card'
import { ValidatorDetails } from './validator-details'

export interface ValidatorScript {
    scriptCbor: string
    scriptAddr: string
    title: string
    hash?: string
}

export function ValidatorSelector() {
    const [validators, setValidators] = useState<ValidatorScript[]>([])
    const [selectedValidator, setSelectedValidator] = useState<ValidatorScript | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function loadValidators() {
            try {
                const res = await fetch('/api/validators');
                const data = await res.json();
                setValidators(data.scripts || []);
                setLoading(false);
            } catch (error) {
                console.error('Error loading validators:', error);
                setLoading(false);
            }
        }
        loadValidators();
    }, []);

    const handleSelectValidator = (validator: ValidatorScript) => {
        setSelectedValidator(validator)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <p className="text-gray-400">Loading validators...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white mb-4">Select a Validator</h2>
                <p className="text-gray-400 mb-6">
                    Choose a validator to lock your assets to. Each validator has different spending conditions.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {validators.map((validator, index) => (
                    <Card
                        key={index}
                        className={`p-6 cursor-pointer transition-all border-2 ${selectedValidator?.title === validator.title
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-purple-500/20 bg-slate-800/50 hover:border-purple-500/40'
                            }`}
                        onClick={() => handleSelectValidator(validator)}
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-white mb-2">
                                    {validator.title.split('.')[0] || validator.title}
                                </h3>
                                <p className="text-xs text-gray-400 font-mono break-all">
                                    {validator.scriptAddr.slice(0, 20)}...{validator.scriptAddr.slice(-20)}
                                </p>
                            </div>
                            {selectedValidator?.title === validator.title && (
                                <div className="ml-2">
                                    <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                ))}
            </div>

            {selectedValidator && <ValidatorDetails validator={selectedValidator} />}
        </div>
    )
}
