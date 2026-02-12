import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { cleanupExpiredMessages, cleanupSignaling, getDatabase } from './database';
import rendezvousRoutes from './routes/rendezvous';
import relayRoutes from './routes/relay';
import signalingRoutes from './routes/signaling';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

// Security headers
app.use(helmet());

// CORS - allow web app origin
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));

// Body parsing
app.use(express.json({ limit: '128kb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(apiLimiter);

// Stricter rate limit for publish operations
const publishLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many publish requests' },
});

// Routes
app.use('/rendezvous', rendezvousRoutes);
app.use('/relay', relayRoutes);
app.use('/signaling', signalingRoutes);

// Apply stricter rate limit to publish endpoint
app.use('/rendezvous/publish', publishLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ---- WebSocket for real-time signaling and relay notifications ----

interface WSClient {
  ws: WebSocket;
  fingerprint: string;
  deviceId: string;
}

const wsClients = new Map<string, WSClient>();

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  let clientKey: string | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      // Registration message
      if (msg.type === 'register') {
        const { fingerprint, deviceId } = msg;
        if (fingerprint && deviceId) {
          clientKey = `${fingerprint}:${deviceId}`;
          wsClients.set(clientKey, { ws, fingerprint, deviceId });
        }
        return;
      }

      // Forward signaling messages in real-time
      if (msg.type === 'signal') {
        const targetKey = `${msg.recipientFingerprint}:${msg.recipientDeviceId}`;
        const target = wsClients.get(targetKey);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({
            type: 'signal',
            senderFingerprint: msg.senderFingerprint,
            senderDeviceId: msg.senderDeviceId,
            signalType: msg.signalType,
            payload: msg.payload,
          }));
        } else {
          // Store for polling if recipient not connected
          const db = getDatabase();
          db.prepare(`
            INSERT INTO signaling (recipient_fingerprint, recipient_device_id, sender_fingerprint, sender_device_id, signal_type, payload)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            msg.recipientFingerprint,
            msg.recipientDeviceId,
            msg.senderFingerprint,
            msg.senderDeviceId,
            msg.signalType,
            JSON.stringify(msg.payload)
          );
        }
        return;
      }

      // Relay notification (notify recipient of new message)
      if (msg.type === 'relay-notify') {
        const targetKey = `${msg.recipientFingerprint}:${msg.recipientDeviceId}`;
        const target = wsClients.get(targetKey);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({
            type: 'relay-notification',
            senderFingerprint: msg.senderFingerprint,
          }));
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (clientKey) {
      wsClients.delete(clientKey);
    }
  });

  ws.on('error', () => {
    if (clientKey) {
      wsClients.delete(clientKey);
    }
  });
});

// Periodic cleanup
setInterval(() => {
  cleanupExpiredMessages();
  cleanupSignaling();
}, 60 * 1000); // Every minute

// Start server
server.listen(PORT, HOST, () => {
  console.log(`E2EE Messenger Server running on ${HOST}:${PORT}`);
  console.log(`WebSocket available at ws://${HOST}:${PORT}/ws`);
  console.log('Endpoints:');
  console.log('  POST   /rendezvous/publish');
  console.log('  GET    /rendezvous/lookup/:fingerprint');
  console.log('  POST   /rendezvous/revoke');
  console.log('  POST   /relay/send');
  console.log('  GET    /relay/fetch/:fingerprint/:deviceId');
  console.log('  DELETE /relay/ack');
  console.log('  POST   /signaling/send');
  console.log('  GET    /signaling/poll/:fingerprint/:deviceId');
  console.log('  GET    /health');
});

export { app, server };
