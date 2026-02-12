'use client';

import { useReducer, useCallback, useEffect } from 'react';
import { storeReducer, initialStore, type AppStore } from '@/lib/store';
import { LockScreen } from '@/components/LockScreen';
import { SetupWizard } from '@/components/SetupWizard';
import { MainLayout } from '@/components/MainLayout';

export default function Home() {
  const [store, dispatch] = useReducer(storeReducer, initialStore);

  // Check for existing setup on mount
  useEffect(() => {
    const hasVault = typeof localStorage !== 'undefined' && localStorage.getItem('e2ee_vault');
    if (hasVault) {
      dispatch({ type: 'SET_STATE', state: 'locked' });
    } else {
      dispatch({ type: 'SET_STATE', state: 'setup' });
    }
  }, []);

  // Dark mode sync
  useEffect(() => {
    if (store.darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [store.darkMode]);

  const handleUnlock = useCallback((fingerprint: string, deviceId: string) => {
    dispatch({ type: 'SET_IDENTITY', fingerprint, deviceId });
    dispatch({ type: 'SET_STATE', state: 'unlocked' });
  }, []);

  const handleSetupComplete = useCallback((fingerprint: string, deviceId: string) => {
    dispatch({ type: 'SET_IDENTITY', fingerprint, deviceId });
    dispatch({ type: 'SET_STATE', state: 'unlocked' });
  }, []);

  const handleLock = useCallback(() => {
    dispatch({ type: 'LOCK' });
  }, []);

  return (
    <div className="h-screen overflow-hidden">
      {store.state === 'locked' && (
        <LockScreen onUnlock={handleUnlock} />
      )}
      {store.state === 'setup' && (
        <SetupWizard onComplete={handleSetupComplete} />
      )}
      {store.state === 'unlocked' && (
        <MainLayout store={store} dispatch={dispatch} onLock={handleLock} />
      )}
    </div>
  );
}
