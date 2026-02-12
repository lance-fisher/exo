'use client';

import { useState } from 'react';
import {
  MessageSquare, Users, Smartphone, Settings, Lock, Sun, Moon,
  Plus, Search, Shield, ChevronLeft
} from 'lucide-react';
import { type AppStore, type StoreAction } from '@/lib/store';
import { ChatView } from './ChatView';
import { ContactList } from './ContactList';
import { AddContact } from './AddContact';
import { ContactDetail } from './ContactDetail';
import { DeviceManager } from './DeviceManager';

interface MainLayoutProps {
  store: AppStore;
  dispatch: React.Dispatch<StoreAction>;
  onLock: () => void;
}

type SidebarView = 'chats' | 'contacts' | 'devices' | 'settings';
type RightPanel = 'none' | 'contact-detail' | 'add-contact';

export function MainLayout({ store, dispatch, onLock }: MainLayoutProps) {
  const [sidebarView, setSidebarView] = useState<SidebarView>('chats');
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [searchQuery, setSearchQuery] = useState('');

  const activeContact = store.contacts.find(
    c => c.fingerprint === store.activeContactFingerprint
  );

  const formatFingerprint = (fp: string) =>
    fp.match(/.{4}/g)?.join(' ') || fp;

  return (
    <div className="h-screen flex bg-[rgb(var(--color-bg))]">
      {/* Sidebar */}
      <div className="w-80 flex flex-col border-r border-[rgb(var(--color-border))]">
        {/* Sidebar header */}
        <div className="p-4 border-b border-[rgb(var(--color-border))]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary-500" />
              <span className="font-semibold text-sm">E2EE Messenger</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => dispatch({ type: 'TOGGLE_DARK_MODE' })}
                className="p-2 rounded-lg hover:bg-[rgb(var(--color-surface))] transition-colors"
                title="Toggle dark mode"
              >
                {store.darkMode ? (
                  <Sun className="w-4 h-4 text-[rgb(var(--color-text-secondary))]" />
                ) : (
                  <Moon className="w-4 h-4 text-[rgb(var(--color-text-secondary))]" />
                )}
              </button>
              <button
                onClick={onLock}
                className="p-2 rounded-lg hover:bg-[rgb(var(--color-surface))] transition-colors"
                title="Lock app"
              >
                <Lock className="w-4 h-4 text-[rgb(var(--color-text-secondary))]" />
              </button>
            </div>
          </div>

          {/* Identity info */}
          <div className="text-xs text-[rgb(var(--color-text-secondary))] font-mono truncate mb-3">
            {store.fingerprint ? formatFingerprint(store.fingerprint) : ''}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4
                               text-[rgb(var(--color-text-secondary))]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="input-field pl-9 text-sm"
            />
          </div>
        </div>

        {/* Sidebar navigation */}
        <div className="flex border-b border-[rgb(var(--color-border))]">
          {[
            { key: 'chats' as const, icon: MessageSquare, label: 'Chats' },
            { key: 'contacts' as const, icon: Users, label: 'Contacts' },
            { key: 'devices' as const, icon: Smartphone, label: 'Devices' },
          ].map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setSidebarView(key)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors
                ${sidebarView === key
                  ? 'text-primary-500 border-b-2 border-primary-500'
                  : 'text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text))]'
                }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto">
          {sidebarView === 'chats' && (
            <ContactList
              contacts={store.contacts}
              activeFingerprint={store.activeContactFingerprint}
              messages={store.messages}
              onSelect={(fingerprint) => {
                dispatch({ type: 'SET_ACTIVE_CONTACT', fingerprint });
                dispatch({ type: 'CLEAR_UNREAD', fingerprint });
              }}
              searchQuery={searchQuery}
            />
          )}
          {sidebarView === 'contacts' && (
            <div>
              <div className="p-3">
                <button
                  onClick={() => setRightPanel('add-contact')}
                  className="w-full btn-primary flex items-center justify-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Contact
                </button>
              </div>
              <ContactList
                contacts={store.contacts}
                activeFingerprint={store.activeContactFingerprint}
                messages={store.messages}
                onSelect={(fingerprint) => {
                  dispatch({ type: 'SET_ACTIVE_CONTACT', fingerprint });
                  setRightPanel('contact-detail');
                }}
                searchQuery={searchQuery}
              />
            </div>
          )}
          {sidebarView === 'devices' && (
            <DeviceManager
              devices={store.devices}
              currentDeviceId={store.deviceId || ''}
              onRevoke={(deviceId) => dispatch({ type: 'REMOVE_DEVICE', deviceId })}
            />
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex">
        <div className="flex-1 flex flex-col">
          {activeContact ? (
            <ChatView
              contact={activeContact}
              messages={store.messages[activeContact.fingerprint] || []}
              store={store}
              dispatch={dispatch}
              onShowDetail={() => setRightPanel('contact-detail')}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3 text-[rgb(var(--color-text-secondary))]">
                <Shield className="w-16 h-16 mx-auto opacity-20" />
                <p className="text-lg">Select a conversation</p>
                <p className="text-sm">Or add a new contact to start messaging</p>
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        {rightPanel !== 'none' && (
          <div className="w-80 border-l border-[rgb(var(--color-border))] overflow-y-auto">
            <div className="p-3 border-b border-[rgb(var(--color-border))] flex items-center gap-2">
              <button
                onClick={() => setRightPanel('none')}
                className="p-1 rounded hover:bg-[rgb(var(--color-surface))]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-medium text-sm">
                {rightPanel === 'add-contact' ? 'Add Contact' : 'Contact Details'}
              </span>
            </div>

            {rightPanel === 'add-contact' && (
              <AddContact
                onAdd={(contact) => {
                  dispatch({ type: 'ADD_CONTACT', contact });
                  setRightPanel('none');
                }}
              />
            )}
            {rightPanel === 'contact-detail' && activeContact && (
              <ContactDetail
                contact={activeContact}
                ownIdentityKey={store.fingerprint || ''}
                onVerify={() => {
                  dispatch({
                    type: 'UPDATE_CONTACT',
                    fingerprint: activeContact.fingerprint,
                    updates: { status: 'verified' },
                  });
                }}
                onRemove={() => {
                  dispatch({ type: 'REMOVE_CONTACT', fingerprint: activeContact.fingerprint });
                  setRightPanel('none');
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
