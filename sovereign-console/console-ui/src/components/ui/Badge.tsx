'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export default function Badge({
  variant = 'neutral',
  dot = false,
  children,
  className,
}: BadgeProps) {
  const variants = {
    success: 'bg-accent-green/10 text-accent-green border-accent-green/20',
    warning: 'bg-accent-amber/10 text-accent-amber border-accent-amber/20',
    danger: 'bg-accent-red/10 text-accent-red border-accent-red/20',
    info: 'bg-accent-blue/10 text-accent-blue border-accent-blue/20',
    neutral: 'bg-surface-overlay text-text-secondary border-border',
  };

  const dotColors = {
    success: 'bg-accent-green',
    warning: 'bg-accent-amber',
    danger: 'bg-accent-red',
    info: 'bg-accent-blue',
    neutral: 'bg-text-muted',
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
          variants[variant],
          className
        )
      )}
    >
      {dot && (
        <span
          className={clsx('h-1.5 w-1.5 rounded-full', dotColors[variant])}
        />
      )}
      {children}
    </span>
  );
}
