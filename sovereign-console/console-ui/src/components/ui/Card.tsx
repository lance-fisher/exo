'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Card({
  children,
  header,
  footer,
  padding = 'md',
  className,
}: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-3',
    md: 'p-5',
    lg: 'p-6',
  };

  return (
    <div
      className={twMerge(
        clsx(
          'rounded-xl border border-border bg-surface-raised',
          className
        )
      )}
    >
      {header && (
        <div className="border-b border-border px-5 py-3">{header}</div>
      )}
      <div className={paddings[padding]}>{children}</div>
      {footer && (
        <div className="border-t border-border px-5 py-3">{footer}</div>
      )}
    </div>
  );
}
