'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';

interface TotpInputProps {
  onComplete: (code: string) => void;
  loading: boolean;
  error: string | null;
}

const DIGIT_COUNT = 6;

export default function TotpInput({
  onComplete,
  loading,
  error,
}: TotpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [shaking, setShaking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Shake on error
  useEffect(() => {
    if (error) {
      setShaking(true);
      const timeout = setTimeout(() => setShaking(false), 500);
      return () => clearTimeout(timeout);
    }
  }, [error]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      if (!/^\d?$/.test(value)) return;

      const newDigits = [...digits];
      newDigits[index] = value;
      setDigits(newDigits);

      // Auto-advance
      if (value && index < DIGIT_COUNT - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Auto-submit when complete
      if (value && index === DIGIT_COUNT - 1) {
        const code = newDigits.join('');
        if (code.length === DIGIT_COUNT) {
          onComplete(code);
        }
      }
    },
    [digits, onComplete]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, DIGIT_COUNT);

      if (pasted.length === 0) return;

      const newDigits = [...digits];
      for (let i = 0; i < pasted.length; i++) {
        newDigits[i] = pasted[i];
      }
      setDigits(newDigits);

      if (pasted.length === DIGIT_COUNT) {
        onComplete(pasted);
      } else {
        inputRefs.current[pasted.length]?.focus();
      }
    },
    [digits, onComplete]
  );

  return (
    <div className="space-y-3">
      <div
        className={clsx(
          'flex justify-center gap-2',
          shaking && 'animate-shake'
        )}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            disabled={loading}
            className={clsx(
              'h-12 w-10 rounded-lg border bg-surface text-center font-mono text-lg text-text-primary transition-colors',
              'focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue/50',
              'disabled:opacity-50',
              error
                ? 'border-accent-red'
                : 'border-border hover:border-border-hover'
            )}
          />
        ))}
      </div>

      {error && (
        <p className="text-center text-xs text-accent-red">{error}</p>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
          Verifying...
        </div>
      )}
    </div>
  );
}
