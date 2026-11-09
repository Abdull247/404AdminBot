CREATE TABLE IF NOT EXISTS platform_link_tokens (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  origin_platform TEXT NOT NULL CHECK (origin_platform IN ('whatsapp', 'telegram')),
  origin_jid TEXT NOT NULL,
  origin_user_id TEXT,
  origin_name TEXT,
  target_platform TEXT NOT NULL CHECK (target_platform IN ('whatsapp', 'telegram')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_jid TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_link_tokens_origin_idx
  ON platform_link_tokens (origin_platform, origin_jid, status);

CREATE INDEX IF NOT EXISTS platform_link_tokens_expires_idx
  ON platform_link_tokens (expires_at);

CREATE TABLE IF NOT EXISTS platform_link_sessions (
  id TEXT PRIMARY KEY,
  whatsapp_jid TEXT NOT NULL,
  telegram_jid TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_user_id TEXT,
  whatsapp_name TEXT,
  telegram_name TEXT,
  token_id BIGINT REFERENCES platform_link_tokens(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'unlinked')),
  one_time BOOLEAN NOT NULL DEFAULT TRUE,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_platform TEXT,
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_link_sessions_whatsapp_active_idx
  ON platform_link_sessions (whatsapp_jid)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS platform_link_sessions_telegram_active_idx
  ON platform_link_sessions (telegram_jid)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS platform_link_sessions_expires_idx
  ON platform_link_sessions (expires_at);
