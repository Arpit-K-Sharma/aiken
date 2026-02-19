'use client'

import { useState, useEffect } from 'react';
import { WalletConnect } from '../components/wallet-connect';
import { ValidatorSelector } from '../components/validator-selector';
import { Button } from '../components/ui/button';

interface WalletInfo {
  id: string;
  name: string;
  icon: string;
  address: string;
}

export default function Home() {
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = () => {
      try {
        const session = sessionStorage.getItem('walletSession');
        if (session) {
          const sessionData = JSON.parse(session);
          // Validate session data
          if (sessionData.id && sessionData.address && sessionData.name) {
            setWalletInfo({
              id: sessionData.id,
              address: sessionData.address,
              name: sessionData.name,
              icon: sessionData.icon || '💼'
            });
          } else {
            // Invalid session data, remove it
            sessionStorage.removeItem('walletSession');
          }
        }
      } catch (error) {
        console.error('Failed to restore wallet session:', error);
        sessionStorage.removeItem('walletSession');
      }
    };

    checkSession();
  }, []);

  const handleConnectWallet = () => {
    setShowDialog(true);
  };

  const handleWalletConnect = (id: string, address: string, name: string, icon: string) => {
    setWalletInfo({ id, address, name, icon });
    setShowDialog(false);
  };

  const handleWalletDisconnect = () => {
    setWalletInfo(null);
    sessionStorage.removeItem('walletSession');
  };

  const handleDialogClose = () => {
    setShowDialog(false);
  };

  const copyAddress = async () => {
    if (!walletInfo?.address) return;

    try {
      await navigator.clipboard.writeText(walletInfo.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <header className="bg-slate-900/50 backdrop-blur-sm border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white">Multi-Sig Wallet</h1>
            </div>
            {!walletInfo ? (
              <Button onClick={handleConnectWallet} size="default" className="shadow-lg border-2 border-purple-500 cursor-pointer">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Connect Wallet
              </Button>
            ) : (
              <div className="flex items-center space-x-3">
                <div className="bg-card px-4 py-2 rounded-lg border flex items-center gap-3">
                  {walletInfo.icon && (walletInfo.icon.startsWith('data:') || walletInfo.icon.startsWith('http://') || walletInfo.icon.startsWith('https://')) ? (
                    <img src={walletInfo.icon} alt={walletInfo.name} className="w-6 h-6 rounded" />
                  ) : (
                    <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center">
                      <span className="text-xs">{walletInfo.icon || '💼'}</span>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">{walletInfo.name}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono">{walletInfo.address.slice(0, 8)}...{walletInfo.address.slice(-6)}</p>
                      <button
                        onClick={copyAddress}
                        className="p-1 rounded hover:bg-purple-500/20 transition-colors"
                        title={copied ? "Copied!" : "Copy address"}
                      >
                        {copied ? (
                          <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                <Button onClick={handleWalletDisconnect} variant="outline" size="default" className="shadow-lg border-2 border-purple-500 cursor-pointer">
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!walletInfo ? (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)]">
            <div className="text-center space-y-6">
              <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full mx-auto flex items-center justify-center animate-pulse">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-4xl font-bold text-white">Welcome to Multi-Sig Wallet</h2>
              <p className="text-gray-400 text-lg max-w-md">
                Connect your Cardano wallet to manage multi-signature transactions securely.
              </p>
              <Button onClick={handleConnectWallet} size="lg" className="shadow-lg border-2 border-purple-500 cursor-pointer">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Connect Wallet to Get Started
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <ValidatorSelector />
          </div>
        )}
      </main>
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto relative border border-purple-500/20">
            <button
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-200 text-2xl font-bold focus:outline-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800"
              onClick={handleDialogClose}
              aria-label="Close"
            >
              ×
            </button>
            <WalletConnect onConnect={handleWalletConnect} onDisconnect={handleWalletDisconnect} />
          </div>
        </div>
      )}
    </div>
  );
}
