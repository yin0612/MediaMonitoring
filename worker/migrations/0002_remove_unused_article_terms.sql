DROP TABLE IF EXISTS article_terms;

CREATE TABLE IF NOT EXISTS refresh_locks (
  name TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);
