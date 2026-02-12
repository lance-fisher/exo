/**
 * Application state management.
 *
 * Intentionally simple: React context + useReducer.
 * No external state library needed for MVP.
 */

export type AppState = 'locked' | 'setup' | 'unlocked';
export type ContactStatus = 'verified' | 'unverified';
export type ConnectionStatus = 'connected' | 'connecting' | 'offline';

export interface Contact {
  fingerprint: string;
  displayName: string;
  messagingIdentityPublicKey: string; // base64
  status: ContactStatus;
  connectionStatus: ConnectionStatus;
  lastSeen?: number;
  safetyNumber?: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  senderFingerprint: string;
  content: string;
  timestamp: number;
  status: 'sending' | 'sent' | 'delivered' | 'failed';
  isOwn: boolean;
}

export interface Device {
  deviceId: string;
  name: string;
  createdAt: number;
  isCurrentDevice: boolean;
  lastActive?: number;
}

export interface AppStore {
  state: AppState;
  fingerprint: string | null;
  deviceId: string | null;
  contacts: Contact[];
  activeContactFingerprint: string | null;
  messages: Record<string, ChatMessage[]>; // fingerprint -> messages
  devices: Device[];
  darkMode: boolean;
  stepUpAuthEnabled: boolean;
}

export const initialStore: AppStore = {
  state: 'locked',
  fingerprint: null,
  deviceId: null,
  contacts: [],
  activeContactFingerprint: null,
  messages: {},
  devices: [],
  darkMode: false,
  stepUpAuthEnabled: true,
};

export type StoreAction =
  | { type: 'SET_STATE'; state: AppState }
  | { type: 'SET_IDENTITY'; fingerprint: string; deviceId: string }
  | { type: 'ADD_CONTACT'; contact: Contact }
  | { type: 'UPDATE_CONTACT'; fingerprint: string; updates: Partial<Contact> }
  | { type: 'REMOVE_CONTACT'; fingerprint: string }
  | { type: 'SET_ACTIVE_CONTACT'; fingerprint: string | null }
  | { type: 'ADD_MESSAGE'; fingerprint: string; message: ChatMessage }
  | { type: 'UPDATE_MESSAGE'; fingerprint: string; messageId: string; updates: Partial<ChatMessage> }
  | { type: 'ADD_DEVICE'; device: Device }
  | { type: 'REMOVE_DEVICE'; deviceId: string }
  | { type: 'TOGGLE_DARK_MODE' }
  | { type: 'SET_STEP_UP_AUTH'; enabled: boolean }
  | { type: 'CLEAR_UNREAD'; fingerprint: string }
  | { type: 'LOCK' }
  | { type: 'RESET' };

export function storeReducer(state: AppStore, action: StoreAction): AppStore {
  switch (action.type) {
    case 'SET_STATE':
      return { ...state, state: action.state };

    case 'SET_IDENTITY':
      return { ...state, fingerprint: action.fingerprint, deviceId: action.deviceId };

    case 'ADD_CONTACT':
      return { ...state, contacts: [...state.contacts, action.contact] };

    case 'UPDATE_CONTACT':
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.fingerprint === action.fingerprint ? { ...c, ...action.updates } : c
        ),
      };

    case 'REMOVE_CONTACT': {
      const { [action.fingerprint]: _, ...remainingMessages } = state.messages;
      return {
        ...state,
        contacts: state.contacts.filter(c => c.fingerprint !== action.fingerprint),
        messages: remainingMessages,
        activeContactFingerprint:
          state.activeContactFingerprint === action.fingerprint
            ? null
            : state.activeContactFingerprint,
      };
    }

    case 'SET_ACTIVE_CONTACT':
      return { ...state, activeContactFingerprint: action.fingerprint };

    case 'ADD_MESSAGE': {
      const existing = state.messages[action.fingerprint] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.fingerprint]: [...existing, action.message],
        },
        contacts: state.contacts.map(c =>
          c.fingerprint === action.fingerprint && !action.message.isOwn &&
          state.activeContactFingerprint !== action.fingerprint
            ? { ...c, unreadCount: c.unreadCount + 1 }
            : c
        ),
      };
    }

    case 'UPDATE_MESSAGE': {
      const msgs = state.messages[action.fingerprint] || [];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.fingerprint]: msgs.map(m =>
            m.id === action.messageId ? { ...m, ...action.updates } : m
          ),
        },
      };
    }

    case 'ADD_DEVICE':
      return { ...state, devices: [...state.devices, action.device] };

    case 'REMOVE_DEVICE':
      return { ...state, devices: state.devices.filter(d => d.deviceId !== action.deviceId) };

    case 'TOGGLE_DARK_MODE':
      return { ...state, darkMode: !state.darkMode };

    case 'SET_STEP_UP_AUTH':
      return { ...state, stepUpAuthEnabled: action.enabled };

    case 'CLEAR_UNREAD':
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.fingerprint === action.fingerprint ? { ...c, unreadCount: 0 } : c
        ),
      };

    case 'LOCK':
      return { ...state, state: 'locked' };

    case 'RESET':
      return initialStore;

    default:
      return state;
  }
}
