'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAgentStatus, useTokenUsage } from '@/lib/hooks';
import { logout } from '@/lib/auth';
import { api, type Session } from '@/lib/api';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import {
  LogOut,
  AlertOctagon,
  Clock,
  Coins,
  ChevronRight,
} from 'lucide-react';

interface TopBarProps {
  session: Session;
}

export default function TopBar({ session }: TopBarProps) {
  const router = useRouter();
  const { status } = useAgentStatus();
  const { usage } = useTokenUsage();
  const [timeLeft, setTimeLeft] = useState('');
  const [showEmergency, setShowEmergency] = useState(false);
  const [disabling, setDisabling] = useState(false);

  // Session timer
  useEffect(() => {
    function update() {
      const expires = new Date(session.expiresAt).getTime();
      const now = Date.now();
      const diff = Math.max(0, expires - now);
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [session.expiresAt]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.replace('/auth');
  }, [router]);

  const handleEmergencyDisable = useCallback(async () => {
    setDisabling(true);
    await api.system.emergencyDisable();
    setShowEmergency(false);
    setDisabling(false);
  }, []);

  const agentOnline = status?.agentOnline ?? false;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface-raised px-6">
      {/* Left: breadcrumb placeholder */}
      <div className="flex items-center gap-1.5 text-sm text-text-muted">
        <span>Console</span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-text-primary">Operations</span>
      </div>

      {/* Right: status items */}
      <div className="flex items-center gap-4">
        {/* Session timer */}
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Clock className="h-3.5 w-3.5" />
          <span>{timeLeft}</span>
        </div>

        {/* Token usage */}
        {usage && (
          <div className="hidden items-center gap-1.5 text-xs text-text-muted md:flex">
            <Coins className="h-3.5 w-3.5" />
            <span>{usage.sessionTotal.toLocaleString()} tokens</span>
          </div>
        )}

        {/* Agent status */}
        <Badge variant={agentOnline ? 'success' : 'danger'} dot>
          {agentOnline ? 'Online' : 'Offline'}
        </Badge>

        {/* Emergency disable */}
        <Button
          variant="danger"
          size="sm"
          onClick={() => setShowEmergency(true)}
          className="hidden sm:inline-flex"
        >
          <AlertOctagon className="mr-1.5 h-3.5 w-3.5" />
          Emergency
        </Button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
          title="Logout"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      {/* Emergency disable modal */}
      {showEmergency && (
        <Modal
          title="Emergency Disable"
          onClose={() => setShowEmergency(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setShowEmergency(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleEmergencyDisable}
                loading={disabling}
              >
                Confirm Emergency Disable
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              This will immediately shut down the agent, terminate all active
              tasks, and revoke all sessions. The system will require manual
              restart.
            </p>
            <div className="rounded-lg border border-accent-red/20 bg-accent-red/5 p-3">
              <p className="text-sm font-medium text-accent-red">
                This action cannot be undone remotely.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </header>
  );
}
