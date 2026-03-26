// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Broker WebSocket Connection (mTLS)
// ─────────────────────────────────────────────────────────────────────────────

import WebSocket from "ws";
import tls from "node:tls";
import https from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { AgentConfig } from "../config.js";
import type { AgentCommand, AgentResponse, ConnectionState } from "../types/index.js";
import { createLogger } from "./logger.js";

const logger = createLogger("broker-connection");

// ── Constants ───────────────────────────────────────────────────────────────

const MIN_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const RECONNECT_BACKOFF_FACTOR = 2;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

// ── Events ──────────────────────────────────────────────────────────────────

export interface BrokerConnectionEvents {
  command: (command: AgentCommand) => void;
  connected: () => void;
  disconnected: (reason: string) => void;
  stateChange: (state: ConnectionState) => void;
  error: (error: Error) => void;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class BrokerConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private _state: ConnectionState = "disconnected";
  private reconnectDelay = MIN_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private readonly config: AgentConfig;
  private readonly baseDir: string;

  constructor(config: AgentConfig, baseDir?: string) {
    super();
    this.config = config;
    this.baseDir = baseDir ?? process.cwd();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Establish the WebSocket connection to the broker using mutual TLS.
   */
  connect(): void {
    if (this._state === "connected" || this._state === "connecting") {
      logger.warn("Connection already active or in progress; ignoring connect()");
      return;
    }

    this.intentionalClose = false;
    this.setState("connecting");

    try {
      const tlsOptions = this.buildTlsOptions();
      const agent = new https.Agent(tlsOptions);

      const url = `${this.config.brokerWsUrl}?agentId=${encodeURIComponent(this.config.agentId)}`;

      this.ws = new WebSocket(url, {
        agent,
        headers: {
          "X-Agent-Id": this.config.agentId,
          Authorization: `Bearer ${this.config.agentSecret}`,
        },
        handshakeTimeout: 15_000,
      });

      this.ws.on("open", this.onOpen.bind(this));
      this.ws.on("message", this.onMessage.bind(this));
      this.ws.on("close", this.onClose.bind(this));
      this.ws.on("error", this.onError.bind(this));
      this.ws.on("pong", this.onPong.bind(this));
    } catch (err) {
      logger.error("Failed to initiate WebSocket connection", { error: err });
      this.setState("disconnected");
      this.scheduleReconnect();
    }
  }

  /**
   * Gracefully disconnect from the broker.
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();

    if (this.ws) {
      try {
        this.ws.close(1000, "Agent shutting down");
      } catch {
        // Already closed
      }
      this.ws = null;
    }

    this.setState("disconnected");
    logger.info("Disconnected from broker");
  }

  /**
   * Send a response back to the broker.
   */
  send<T>(response: AgentResponse<T>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error("Cannot send response: WebSocket is not open", {
        requestId: response.requestId,
        state: this._state,
      });
      return;
    }

    try {
      const payload = JSON.stringify(response);
      this.ws.send(payload, (err) => {
        if (err) {
          logger.error("Failed to send response", {
            requestId: response.requestId,
            error: err.message,
          });
        } else {
          logger.debug("Response sent", {
            requestId: response.requestId,
            status: response.status,
          });
        }
      });
    } catch (err) {
      logger.error("Error serializing response", {
        requestId: response.requestId,
        error: err,
      });
    }
  }

  // ── WebSocket Event Handlers ────────────────────────────────────────────

  private onOpen(): void {
    logger.info("Connected to broker", { url: this.config.brokerWsUrl });
    this.reconnectDelay = MIN_RECONNECT_DELAY_MS;
    this.setState("connected");
    this.startHeartbeat();
    this.emit("connected");
  }

  private onMessage(data: WebSocket.RawData): void {
    try {
      const raw = data.toString("utf-8");
      const command = JSON.parse(raw) as AgentCommand;

      if (!command.type || !command.requestId) {
        logger.warn("Received malformed command (missing type or requestId)", {
          raw: raw.slice(0, 200),
        });
        return;
      }

      logger.info("Received command", {
        type: command.type,
        requestId: command.requestId,
      });

      this.emit("command", command);
    } catch (err) {
      logger.error("Failed to parse broker message", { error: err });
    }
  }

  private onClose(code: number, reason: Buffer): void {
    const reasonStr = reason.toString("utf-8") || `code=${code}`;
    logger.warn("WebSocket closed", { code, reason: reasonStr });

    this.clearTimers();
    this.ws = null;

    if (this.intentionalClose) {
      this.setState("disconnected");
      this.emit("disconnected", reasonStr);
    } else {
      this.setState("reconnecting");
      this.emit("disconnected", reasonStr);
      this.scheduleReconnect();
    }
  }

  private onError(err: Error): void {
    // Don't log the full error object to avoid leaking cert details
    logger.error("WebSocket error", { message: err.message });
    this.emit("error", err);
  }

  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    logger.debug("Pong received from broker");
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      this.ws.ping();
      logger.debug("Ping sent to broker");

      // If we don't receive a pong within the timeout, assume connection is dead
      this.pongTimer = setTimeout(() => {
        logger.warn("Pong timeout — closing connection");
        if (this.ws) {
          this.ws.terminate();
        }
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // ── Reconnection ─────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    logger.info(`Reconnecting in ${this.reconnectDelay}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF_FACTOR,
      MAX_RECONNECT_DELAY_MS,
    );
  }

  // ── TLS ───────────────────────────────────────────────────────────────

  private buildTlsOptions(): tls.ConnectionOptions {
    const resolve = (p: string) =>
      path.isAbsolute(p) ? p : path.resolve(this.baseDir, p);

    return {
      ca: readFileSync(resolve(this.config.mtls.caCertPath), "utf-8"),
      cert: readFileSync(resolve(this.config.mtls.certPath), "utf-8"),
      key: readFileSync(resolve(this.config.mtls.keyPath), "utf-8"),
      rejectUnauthorized: true,
      // Minimum TLS 1.2 for security
      minVersion: "TLSv1.2",
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      const prev = this._state;
      this._state = state;
      logger.info("Connection state changed", { from: prev, to: state });
      this.emit("stateChange", state);
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
