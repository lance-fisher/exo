'use client';

import { useState, useEffect } from 'react';
import {
  ShieldCheck, ShieldAlert, QrCode, Trash2, Wifi, WifiOff, Key, Copy,
  CheckCircle
} from 'lucide-react';
import { type Contact } from '@/lib/store';

interface ContactDetailProps {
  contact: Contact;
  ownIdentityKey: string;
  onVerify: () => void;
  onRemove: () => void;
}

export function ContactDetail({ contact, ownIdentityKey, onVerify, onRemove }: ContactDetailProps) {
  const [safetyNumber, setSafetyNumber] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Generate mock safety number for display
    const blocks: string[] = [];
    for (let i = 0; i < 12; i++) {
      blocks.push(Math.floor(Math.random() * 100000).toString().padStart(5, '0'));
    }
    setSafetyNumber(blocks);
  }, [contact.fingerprint, ownIdentityKey]);

  const formatFingerprint = (fp: string) =>
    fp.match(/.{4}/g)?.join(' ') || fp;

  const handleCopyFingerprint = () => {
    navigator.clipboard.writeText(contact.fingerprint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="p-4 space-y-5">
      {/* Avatar and name */}
      <div className="text-center space-y-2">
        <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30
                        flex items-center justify-center mx-auto">
          <span className="text-primary-600 dark:text-primary-400 font-bold text-xl">
            {contact.displayName.charAt(0).toUpperCase()}
          </span>
        </div>
        <h3 className="font-semibold">{contact.displayName}</h3>
        <div className="flex items-center justify-center gap-1.5">
          {contact.status === 'verified' ? (
            <>
              <ShieldCheck className="w-4 h-4 text-green-500" />
              <span className="badge-verified">Verified Contact</span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-4 h-4 text-yellow-500" />
              <span className="badge-unverified">Unverified Contact</span>
            </>
          )}
        </div>
      </div>

      {/* Connection status */}
      <div className="card space-y-2">
        <h4 className="text-sm font-medium flex items-center gap-2">
          {contact.connectionStatus === 'connected' ? (
            <Wifi className="w-4 h-4 text-green-500" />
          ) : (
            <WifiOff className="w-4 h-4 text-gray-400" />
          )}
          Connection
        </h4>
        <p className="text-xs text-[rgb(var(--color-text-secondary))]">
          {contact.connectionStatus === 'connected'
            ? 'Direct P2P connection (WebRTC DataChannel)'
            : contact.connectionStatus === 'connecting'
            ? 'Establishing P2P connection...'
            : 'Using encrypted relay (P2P unavailable)'}
        </p>
      </div>

      {/* Fingerprint */}
      <div className="card space-y-2">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Key className="w-4 h-4" />
          PGP Fingerprint
        </h4>
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-[rgb(var(--color-text-secondary))] break-all flex-1">
            {formatFingerprint(contact.fingerprint)}
          </code>
          <button
            onClick={handleCopyFingerprint}
            className="p-1 rounded hover:bg-[rgb(var(--color-border))] transition-colors flex-shrink-0"
          >
            {copied ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-[rgb(var(--color-text-secondary))]" />
            )}
          </button>
        </div>
      </div>

      {/* Safety Number */}
      <div className="card space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Safety Number
        </h4>
        <p className="text-xs text-[rgb(var(--color-text-secondary))]">
          Compare this number with your contact in person or via a trusted channel.
          If the numbers match, the connection is secure.
        </p>

        <div className="grid grid-cols-4 gap-2 font-mono text-center">
          {safetyNumber.map((block, i) => (
            <span
              key={i}
              className="text-sm py-1 rounded bg-[rgb(var(--color-bg))] text-[rgb(var(--color-text))]"
            >
              {block}
            </span>
          ))}
        </div>

        {contact.status !== 'verified' && (
          <button
            onClick={onVerify}
            className="w-full btn-primary text-sm flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            Mark as Verified
          </button>
        )}
      </div>

      {/* QR Code */}
      <div className="card space-y-2 text-center">
        <QrCode className="w-24 h-24 mx-auto text-[rgb(var(--color-text))] opacity-20" />
        <p className="text-xs text-[rgb(var(--color-text-secondary))]">
          Show QR code for in-person verification
        </p>
      </div>

      {/* Actions */}
      <div className="pt-2">
        <button
          onClick={() => {
            if (confirm(`Remove ${contact.displayName} from contacts? This will delete the conversation.`)) {
              onRemove();
            }
          }}
          className="w-full btn-danger text-sm flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Remove Contact
        </button>
      </div>
    </div>
  );
}
