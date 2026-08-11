CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  sentiment_json TEXT,
  provenance_json TEXT,
  ingested_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles(canonical_url);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_time ON articles(source_id, published_at DESC);

CREATE TABLE IF NOT EXISTS article_terms (
  article_id TEXT NOT NULL,
  term TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'keyword',
  PRIMARY KEY (article_id, term, kind),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_terms_term ON article_terms(term, kind);
