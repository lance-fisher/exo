'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAgentStatus } from '@/lib/hooks';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Zap,
  FolderOpen,
  ScrollText,
  Smartphone,
  Settings,
  Menu,
  X,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: Zap },
  { href: '/files', label: 'Files', icon: FolderOpen },
  { href: '/audit', label: 'Audit', icon: ScrollText },
  { href: '/devices', label: 'Devices', icon: Smartphone },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { status } = useAgentStatus();
  const [mobileOpen, setMobileOpen] = useState(false);

  const agentOnline = status?.agentOnline ?? false;

  const nav = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-blue/10 text-sm font-bold text-accent-blue">
            SC
          </div>
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            Sovereign Console
          </span>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent-blue/10 text-accent-blue'
                  : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Agent status at bottom */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2">
          <div
            className={clsx(
              'h-2 w-2 rounded-full',
              agentOnline
                ? 'bg-accent-green animate-pulse-slow'
                : 'bg-text-muted'
            )}
          />
          <span className="text-xs text-text-muted">
            Agent {agentOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg border border-border bg-surface-raised p-2 lg:hidden"
      >
        {mobileOpen ? (
          <X className="h-5 w-5 text-text-primary" />
        ) : (
          <Menu className="h-5 w-5 text-text-primary" />
        )}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-60 border-r border-border bg-surface-raised transition-transform lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {nav}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-shrink-0 border-r border-border bg-surface-raised lg:block">
        {nav}
      </aside>
    </>
  );
}
