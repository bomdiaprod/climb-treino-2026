CREATE TABLE workouts (
  id TEXT PRIMARY KEY NOT NULL,
  project TEXT NOT NULL CHECK (project = 'climb-treino-2026'),
  session TEXT NOT NULL CHECK (session IN ('A', 'B', 'C')),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
  log_text TEXT NOT NULL CHECK (length(log_text) BETWEEN 1 AND 12000),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processed_at TEXT
);

CREATE INDEX workouts_status_completed_idx
ON workouts(status, completed_at);
