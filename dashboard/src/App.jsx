import React, { useEffect, useState } from 'react';
import { useWallet } from './hooks/useWallet';
import PaymentHistory from './components/PaymentHistory';
import RefundManager from './components/RefundManager';
import MerchantProfile from './components/MerchantProfile';
import AdminPanel from './components/AdminPanel';
import MobileNav from './components/MobileNav';
import './App.css';

const TABS = [
  { id: 'Payments', label: 'Payments' },
  { id: 'Refunds', label: 'Refunds' },
  { id: 'Profile', label: 'Profile' },
  { id: 'Admin', label: 'Admin' },
];

export default function App() {
  const {
    publicKey,
    connectFreighter,
    connectAlbedo,
    disconnect,
    walletType,
    error,
  } = useWallet();

  const [tab, setTab] = useState('Payments');
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem('pulsar-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('pulsar-theme', theme);
  }, [theme]);

  return (
    <div className="app">
      {/* WCAG 2.4.1 — skip navigation */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="app-header">
        <h1>Pulsar Merchant Dashboard</h1>
        <button
          type="button"
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        {publicKey ? (
          <div className="wallet-info">
            <span
              className="wallet-address"
              title={publicKey}
              aria-label={`Connected wallet: ${publicKey}`}
            >
              {publicKey.slice(0, 8)}…{publicKey.slice(-4)}
              {walletType && <> ({walletType})</>}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="wallet-buttons">
            <button className="btn btn-ghost btn-sm" onClick={connectFreighter}>
              Connect Freighter
            </button>
            <button className="btn btn-ghost btn-sm" onClick={connectAlbedo}>
              Connect Albedo
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" aria-live="assertive" className="alert alert-error" style={{ margin: '1rem 1.5rem 0' }}>
          {error}
        </div>
      )}

      {!publicKey ? (
        <main id="main-content" className="connect-prompt" aria-label="Connect wallet">
          <h2>Connect your wallet</h2>
          <p>Connect your Freighter or Albedo wallet to access the merchant dashboard.</p>
          <div className="wallet-buttons">
            <button className="btn btn-primary" onClick={connectFreighter}>
              Connect Freighter
            </button>
            <button className="btn btn-secondary" onClick={connectAlbedo}>
              Connect Albedo
            </button>
          </div>
        </main>
      ) : (
        <>
          <MobileNav tabs={TABS} activeTab={tab} onSelect={setTab} />

          <div
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            aria-label={tab}
            className="tab-content"
          >
            {tab === 'Payments' && <PaymentHistory merchantAddress={publicKey} />}
            {tab === 'Refunds'  && <RefundManager  merchantAddress={publicKey} />}
            {tab === 'Profile'  && <MerchantProfile publicKey={publicKey} />}
            {tab === 'Admin'    && <AdminPanel      adminAddress={publicKey} />}
          </div>
        </main>
      )}
    </div>
  );
}
