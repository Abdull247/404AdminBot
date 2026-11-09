-- Admin tasks / reminders table.
-- The single admin (Error404) can ask the bot to remember tasks, reminders,
-- and to-dos. Each row belongs to a chat (jid) and can carry a due date.

CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  jid TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  priority SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_jid_status_due_idx ON tasks (jid, status, due_at);
CREATE INDEX IF NOT EXISTS tasks_jid_created_at_idx ON tasks (jid, created_at DESC);
