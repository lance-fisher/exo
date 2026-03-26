-- =============================================================================
-- Sovereign Operator Console — PostgreSQL Schema
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- operators
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operators (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR(64) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id             UUID NOT NULL REFERENCES operators(id),
    name                    VARCHAR(128) NOT NULL,
    type                    VARCHAR(16) NOT NULL CHECK (type IN ('laptop', 'iphone')),
    status                  VARCHAR(16) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'enrolled', 'revoked', 'suspended')),
    enrolled_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at              TIMESTAMPTZ,
    fingerprint             VARCHAR(256) NOT NULL UNIQUE,
    platform_info           JSONB NOT NULL DEFAULT '{}',
    passkey_credential_id   VARCHAR(512),
    mtls_cert_fingerprint   VARCHAR(256),
    last_seen               TIMESTAMPTZ,
    risk_flags              TEXT[] NOT NULL DEFAULT '{}',

    CONSTRAINT uq_device_operator_name UNIQUE (operator_id, name)
);

CREATE INDEX idx_devices_operator ON devices(operator_id);
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_fingerprint ON devices(fingerprint);

-- ---------------------------------------------------------------------------
-- passkey_credentials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passkey_credentials (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id           UUID NOT NULL REFERENCES devices(id),
    credential_id       VARCHAR(1024) NOT NULL UNIQUE,
    public_key          TEXT NOT NULL,
    counter             BIGINT NOT NULL DEFAULT 0,
    transports          TEXT[] NOT NULL DEFAULT '{}',
    attestation_format  VARCHAR(32) NOT NULL DEFAULT 'none',
    platform_bound      BOOLEAN NOT NULL DEFAULT false,
    synced_status       VARCHAR(16) NOT NULL DEFAULT 'unknown'
                        CHECK (synced_status IN ('synced', 'device_bound', 'unknown')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_passkey_device ON passkey_credentials(device_id);
CREATE INDEX idx_passkey_credential_id ON passkey_credentials(credential_id);

-- ---------------------------------------------------------------------------
-- totp_secrets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS totp_secrets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id         UUID NOT NULL REFERENCES operators(id),
    encrypted_secret    TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX idx_totp_operator ON totp_secrets(operator_id);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id     UUID NOT NULL REFERENCES operators(id),
    device_id       UUID NOT NULL REFERENCES devices(id),
    token_hash      VARCHAR(256) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    ip_address      INET NOT NULL,
    user_agent      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_sessions_operator ON sessions(operator_id);
CREATE INDEX idx_sessions_device ON sessions(device_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- approval_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_tokens (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action_type             VARCHAR(32) NOT NULL,
    resource_path           TEXT NOT NULL,
    operation               VARCHAR(64) NOT NULL,
    device_id               UUID NOT NULL REFERENCES devices(id),
    session_id              UUID NOT NULL REFERENCES sessions(id),
    issued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ NOT NULL,
    nonce                   VARCHAR(128) NOT NULL UNIQUE,
    payload_hash            VARCHAR(256) NOT NULL,
    status                  VARCHAR(16) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'used', 'rejected', 'expired', 'revoked')),
    approved_by_device_id   UUID REFERENCES devices(id),
    approved_at             TIMESTAMPTZ,
    used_at                 TIMESTAMPTZ,
    revoked_at              TIMESTAMPTZ
);

CREATE INDEX idx_approval_session ON approval_tokens(session_id);
CREATE INDEX idx_approval_device ON approval_tokens(device_id);
CREATE INDEX idx_approval_status ON approval_tokens(status);
CREATE INDEX idx_approval_expires ON approval_tokens(expires_at);
CREATE INDEX idx_approval_nonce ON approval_tokens(nonce);

-- ---------------------------------------------------------------------------
-- audit_log — immutable, append-only, hash-chained
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    event_type  VARCHAR(64) NOT NULL,
    operator_id UUID,
    device_id   UUID,
    session_id  UUID,
    action      VARCHAR(256) NOT NULL,
    resource    TEXT,
    detail      JSONB NOT NULL DEFAULT '{}',
    ip_address  INET NOT NULL,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prev_hash   VARCHAR(128) NOT NULL DEFAULT '',
    entry_hash  VARCHAR(128) NOT NULL DEFAULT ''
);

CREATE INDEX idx_audit_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_operator ON audit_log(operator_id);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_session ON audit_log(session_id);

-- Trigger: prevent UPDATE and DELETE on audit_log
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is immutable: % operations are forbidden', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- agent_registrations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_registrations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    VARCHAR(128) NOT NULL,
    fingerprint             VARCHAR(256) NOT NULL UNIQUE,
    mtls_cert_fingerprint   VARCHAR(256) NOT NULL UNIQUE,
    status                  VARCHAR(16) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'revoked', 'suspended')),
    registered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_connected          TIMESTAMPTZ,
    version                 VARCHAR(32) NOT NULL DEFAULT '0.0.0'
);

CREATE INDEX idx_agent_status ON agent_registrations(status);
CREATE INDEX idx_agent_fingerprint ON agent_registrations(fingerprint);

-- ---------------------------------------------------------------------------
-- command_queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS command_queue (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES sessions(id),
    command         JSONB NOT NULL,
    status          VARCHAR(24) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'pending_reconfirm', 'confirmed', 'executing', 'completed', 'expired', 'rejected')),
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ttl_expires_at  TIMESTAMPTZ NOT NULL,
    reconfirmed_at  TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    result          JSONB
);

CREATE INDEX idx_cmdq_session ON command_queue(session_id);
CREATE INDEX idx_cmdq_status ON command_queue(status);
CREATE INDEX idx_cmdq_ttl ON command_queue(ttl_expires_at);

-- ---------------------------------------------------------------------------
-- recovery_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_codes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id),
    code_hash   VARCHAR(256) NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recovery_operator ON recovery_codes(operator_id);

-- ---------------------------------------------------------------------------
-- token_usage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token_usage (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES sessions(id),
    task_id         VARCHAR(128) NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    model           VARCHAR(64) NOT NULL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_usage_session ON token_usage(session_id);
CREATE INDEX idx_token_usage_task ON token_usage(task_id);
CREATE INDEX idx_token_usage_timestamp ON token_usage(timestamp);
