'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: 'default' | 'code';
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, variant = 'default', className, ...props }, ref) => {
    const isCode = variant === 'code';

    return (
      <div className="w-full">
        {label && (
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={twMerge(
            clsx(
              'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted transition-colors',
              'focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue/50',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error
                ? 'border-accent-red focus:border-accent-red focus:ring-accent-red/50'
                : 'border-border hover:border-border-hover',
              isCode &&
                'text-center font-mono text-lg tracking-[0.5em]',
              className
            )
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-accent-red">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
