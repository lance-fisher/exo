'use client';

import { ShieldCheck, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { type Contact, type ChatMessage } from '@/lib/store';

interface ContactListProps {
  contacts: Contact[];
  activeFingerprint: string | null;
  messages: Record<string, ChatMessage[]>;
  onSelect: (fingerprint: string) => void;
  searchQuery: string;
}

export function ContactList({
  contacts,
  activeFingerprint,
  messages,
  onSelect,
  searchQuery,
}: ContactListProps) {
  const filtered = contacts.filter(c =>
    c.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.fingerprint.includes(searchQuery.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <div className="p-6 text-center text-[rgb(var(--color-text-secondary))] text-sm">
        {contacts.length === 0
          ? 'No contacts yet. Add one to start messaging.'
          : 'No contacts match your search.'}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[rgb(var(--color-border))]">
      {filtered.map(contact => {
        const contactMessages = messages[contact.fingerprint] || [];
        const lastMessage = contactMessages[contactMessages.length - 1];
        const isActive = activeFingerprint === contact.fingerprint;

        return (
          <button
            key={contact.fingerprint}
            onClick={() => onSelect(contact.fingerprint)}
            className={`w-full text-left p-3 transition-colors flex items-start gap-3
              ${isActive
                ? 'bg-primary-50 dark:bg-primary-950/30'
                : 'hover:bg-[rgb(var(--color-surface))]'
              }`}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30
                              flex items-center justify-center">
                <span className="text-primary-600 dark:text-primary-400 font-medium text-sm">
                  {contact.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              {/* Connection indicator */}
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2
                border-[rgb(var(--color-bg))] ${
                  contact.connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : contact.connectionStatus === 'connecting'
                    ? 'bg-yellow-500'
                    : 'bg-gray-400'
                }`}
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm truncate">{contact.displayName}</span>
                  {contact.status === 'verified' ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
                  )}
                </div>
                {lastMessage && (
                  <span className="text-xs text-[rgb(var(--color-text-secondary))]">
                    {formatTime(lastMessage.timestamp)}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between mt-0.5">
                <p className="text-xs text-[rgb(var(--color-text-secondary))] truncate">
                  {lastMessage
                    ? lastMessage.isOwn
                      ? `You: ${lastMessage.content}`
                      : lastMessage.content
                    : 'No messages'}
                </p>

                {contact.unreadCount > 0 && (
                  <span className="ml-2 flex-shrink-0 min-w-[20px] h-5 rounded-full
                                   bg-primary-600 text-white text-xs font-medium
                                   flex items-center justify-center px-1.5">
                    {contact.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatTime(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
