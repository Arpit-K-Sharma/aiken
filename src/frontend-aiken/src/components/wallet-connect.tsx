"use client"

import { useState, useEffect } from 'react'
import config from '../lib/config'
import { Button } from './ui/button'

// Wallet configuration with default icons
const SUPPORTED_WALLETS = [
    { id: 'lace', name: 'Lace', icon: '💎', installUrl: 'https://www.lace.io/' },
    { id: 'eternl', name: 'Eternl', icon: '🦋', installUrl: 'https://eternl.io/' },
    { id: 'typhoncip30', name: 'Typhon', icon: '🌊', installUrl: 'https://typhonwallet.io/' },
]

// Default wallet icon component
const DefaultWalletIcon = () => (
    <div className="w-8 h-8 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-lg flex items-center justify-center border border-purple-500/30">
        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
    </div>
)

// Check if a string is a valid icon (not a chrome extension URL)
const isValidIcon = (icon: string | undefined): boolean => {
    if (!icon) return false
    // Filter out chrome-extension URLs and other invalid strings
    if (icon.startsWith('chrome-extension://')) return false
    if (icon.length > 500 && !icon.startsWith('data:') && !icon.startsWith('http')) return false
    return true
}

// Check if a string is a valid name (not a chrome extension URL)
const isValidName = (name: string | undefined): boolean => {
    if (!name) return false
    if (name.startsWith('chrome-extension://')) return false
    if (name.length > 100) return false
    return true
}

interface WalletConnectProps {
    onConnect?: (walletId: string, address: string, name: string, icon: string) => void
    onDisconnect?: () => void
}

export function WalletConnect({ onConnect, onDisconnect }: WalletConnectProps = {}) {
    const [connectedWallet, setConnectedWallet] = useState<{ id: string; name: string; icon: string } | null>(null)
    const [walletAddress, setWalletAddress] = useState<string | null>(null)
    const [installedWallets, setInstalledWallets] = useState<typeof SUPPORTED_WALLETS>([])
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        const session = sessionStorage.getItem('walletSession')
        if (session) {
            try {
                const { id, address, name, icon } = JSON.parse(session)
                if (id && address) {
                    setConnectedWallet({
                        id,
                        name: name || SUPPORTED_WALLETS.find(w => w.id === id)?.name || id,
                        icon: icon || SUPPORTED_WALLETS.find(w => w.id === id)?.icon || '💼',
                    })
                    setWalletAddress(address)
                }
            } catch (e) {
                console.error('Failed to restore session:', e)
            }
        }
    }, [])

    // Check for installed wallets
    const checkInstalledWallets = () => {
        if (typeof window === 'undefined' || !(window as any).cardano) {
            return []
        }

        const installed = SUPPORTED_WALLETS.filter(wallet => {
            try {
                return (window as any).cardano[wallet.id] !== undefined
            } catch {
                return false
            }
        })

        return installed
    }

    // Initial check and periodic updates
    useEffect(() => {
        const checkWallets = () => {
            const wallets = checkInstalledWallets()
            setInstalledWallets(wallets)
        }

        // Initial check after a short delay to allow extensions to load
        setTimeout(checkWallets, 100)

        // Periodic check for newly installed wallets
        const interval = setInterval(checkWallets, 1000)

        return () => clearInterval(interval)
    }, [])

    // Connect to wallet
    const connectWallet = async (walletId: string) => {
        setIsConnecting(true)
        setError(null)

        try {
            if (!(window as any).cardano || !(window as any).cardano[walletId]) {
                throw new Error(`${walletId} wallet not found. Please install the extension.`)
            }

            const walletApi = (window as any).cardano[walletId]

            // Try to enable wallet with network preference
            let api
            try {
                api = await walletApi.enable({ network: config.cardanoNetwork })
            } catch (e) {
                // Fallback to plain enable()
                api = await walletApi.enable()
            }

            // Get the address
            const usedAddresses = await api.getUsedAddresses()
            const unusedAddresses = await api.getUnusedAddresses()
            const rawAddress = usedAddresses[0] || unusedAddresses[0]

            if (!rawAddress) {
                throw new Error('No addresses found in wallet')
            }

            // Convert to bech32 format if needed
            let address = rawAddress
            if (typeof rawAddress === 'string' && rawAddress.startsWith('addr')) {
                // Already in bech32 format
                address = rawAddress
            } else {
                // Try to convert hex to bech32 using cardano-serialization-lib
                try {
                    const bytes = typeof rawAddress === 'string'
                        ? new Uint8Array(rawAddress.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
                        : new Uint8Array(rawAddress)

                    // Import CSL dynamically
                    const CSL = await import('@emurgo/cardano-serialization-lib-browser')
                    const addr = CSL.Address.from_bytes(bytes)
                    address = addr.to_bech32()
                } catch (e) {
                    console.error('Failed to convert address to bech32:', e)
                    address = typeof rawAddress === 'string' ? rawAddress : '[Address conversion failed]'
                }
            }

            // Get wallet info from supported wallets list
            const walletConfig = SUPPORTED_WALLETS.find(w => w.id === walletId)

            // Get wallet icon and name from window.cardano (preferred) or fallback to config
            // Filter out invalid icons and names (like chrome-extension URLs)
            const apiIcon = isValidIcon(walletApi.icon) ? walletApi.icon : null
            const apiName = isValidName(walletApi.name) ? walletApi.name : null

            const walletIcon = apiIcon || walletConfig?.icon || ''
            const walletName = apiName || walletConfig?.name || walletId

            const connectedInfo = {
                id: walletId,
                name: walletName,
                icon: walletIcon,
            }

            setConnectedWallet(connectedInfo)
            setWalletAddress(address)

            sessionStorage.setItem('walletSession', JSON.stringify({
                id: walletId,
                address,
                name: walletName,
                icon: walletIcon,
            }))

            if (onConnect) {
                onConnect(walletId, address, walletName, walletIcon)
            }

            console.log('Connected to', walletName, 'with address:', address)
        } catch (err: any) {
            console.error('Wallet connection error:', err)
            setError(err.message || 'Failed to connect to wallet')
        } finally {
            setIsConnecting(false)
        }
    }

    // Disconnect wallet
    const disconnectWallet = () => {
        setConnectedWallet(null)
        setWalletAddress(null)
        setError(null)
        sessionStorage.removeItem('walletSession')
        if (onDisconnect) {
            onDisconnect()
        }
    }

    // Format address for display
    const formatAddress = (addr: string) => {
        if (!addr) return ''
        if (addr.length < 20) return addr
        return `${addr.slice(0, 8)}...${addr.slice(-8)}`
    }

    // Copy address to clipboard
    const copyAddress = async () => {
        if (!walletAddress) return

        try {
            await navigator.clipboard.writeText(walletAddress)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy address:', err)
        }
    }

    return (
        <div className="flex flex-col gap-4 items-center justify-center p-6">
            <h2 className="text-2xl font-bold mb-2 text-white">Connect Cardano Wallet</h2>

            {connectedWallet ? (
                <div className="flex flex-col items-center gap-4 w-full max-w-md">
                    <div className="w-full p-4 rounded-xl bg-green-900/20 border-2 border-green-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {isValidIcon(connectedWallet.icon) && (connectedWallet.icon.startsWith('data:') || connectedWallet.icon.startsWith('http://') || connectedWallet.icon.startsWith('https://')) ? (
                                <img src={connectedWallet.icon} alt={connectedWallet.name} className="w-8 h-8 rounded" onError={(e) => e.currentTarget.style.display = 'none'} />
                            ) : isValidIcon(connectedWallet.icon) && !connectedWallet.icon.startsWith('data:') && !connectedWallet.icon.startsWith('http') ? (
                                <span className="text-2xl">{connectedWallet.icon}</span>
                            ) : (
                                <DefaultWalletIcon />
                            )}
                            <div>
                                <p className="font-semibold text-white">{connectedWallet.name}</p>
                                <p className="text-xs text-green-400 font-medium">Connected</p>
                            </div>
                        </div>
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                    </div>

                    {walletAddress && (
                        <div className="w-full p-4 rounded-xl bg-slate-800">
                            <p className="text-xs text-gray-400 mb-1">Address</p>
                            <div className="flex items-center gap-2">
                                <p className="font-mono text-sm text-white break-all flex-1">{formatAddress(walletAddress)}</p>
                                <button
                                    onClick={copyAddress}
                                    className="p-2 rounded bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 transition-colors"
                                    title={copied ? "Copied!" : "Copy address"}
                                >
                                    {copied ? (
                                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    <Button onClick={disconnectWallet} variant="destructive" className="w-full cursor-pointer border-2 border-purple-500">
                        <span className="w-full">Disconnect</span>
                    </Button>
                </div>
            ) : (
                <div className="w-full max-w-md space-y-3">
                    {error && (
                        <div className="p-4 bg-red-900/20 border border-red-800/20 rounded-xl">
                            <p className="text-sm text-red-400">{error}</p>
                        </div>
                    )}

                    {installedWallets.length === 0 ? (
                        <div className="text-center py-4">
                            <p className="text-gray-400 mb-4 text-sm">
                                No wallets detected. Please install a Cardano wallet extension and refresh the page.
                            </p>
                        </div>
                    ) : null}

                    {SUPPORTED_WALLETS.map((wallet) => {
                        const isInstalled = installedWallets.some(w => w.id === wallet.id)
                        // Try to get wallet icon from window.cardano if installed
                        const walletApi = typeof window !== 'undefined' && isInstalled ? (window as any).cardano?.[wallet.id] : null

                        // Get icon and name, filtering out invalid values
                        const apiIcon = isValidIcon(walletApi?.icon) ? walletApi.icon : null
                        const apiName = isValidName(walletApi?.name) ? walletApi.name : null

                        const walletIcon = apiIcon || wallet.icon
                        const walletDisplayName = apiName || wallet.name

                        // Check if icon is a URL (data URL, http, https) or an emoji
                        const isIconUrl = typeof walletIcon === 'string' && (walletIcon.startsWith('data:') || walletIcon.startsWith('http://') || walletIcon.startsWith('https://'))
                        const hasValidIcon = isValidIcon(walletIcon)

                        return (
                            <div
                                key={wallet.id}
                                className={`border-2 rounded-xl p-4 transition-all ${isInstalled
                                    ? 'border-purple-500/20 bg-purple-500/5 hover:border-purple-500/40'
                                    : 'border-slate-700 bg-slate-800/50 opacity-60'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {!hasValidIcon ? (
                                            <DefaultWalletIcon />
                                        ) : isIconUrl ? (
                                            <img src={walletIcon} alt={walletDisplayName} className="w-8 h-8 rounded" onError={(e) => e.currentTarget.style.display = 'none'} />
                                        ) : (
                                            <span className="text-3xl">{walletIcon}</span>
                                        )}
                                        <div>
                                            <p className="font-semibold text-white">{walletDisplayName}</p>
                                            <p className="text-xs text-gray-400">
                                                {isInstalled ? 'Installed' : 'Not installed'}
                                            </p>
                                        </div>
                                    </div>

                                    {isInstalled ? (
                                        <Button
                                            onClick={() => connectWallet(wallet.id)}
                                            disabled={isConnecting}
                                            size="sm"
                                            className="cursor-pointer hover:cursor-pointer border-2 border-purple-500"
                                        >
                                            {isConnecting ? 'Connecting...' : 'Connect'}
                                        </Button>
                                    ) : (
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="sm"
                                        >
                                            <a href={wallet.installUrl} target="_blank" rel="noopener noreferrer">
                                                Install
                                            </a>
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )
                    })}

                    <div className="mt-4 p-4 bg-yellow-900/20 rounded-xl border border-yellow-800">
                        <p className="text-xs text-yellow-400">
                            💡 <strong>Tip:</strong> If you just installed a wallet, please refresh this page.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
