CREATE TABLE IF NOT EXISTS publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    page_id TEXT NOT NULL DEFAULT '',
    page_name TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'text',
    message TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'published',
    published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_publications_post_id ON publications(post_id);
CREATE INDEX IF NOT EXISTS idx_publications_platform ON publications(platform);
CREATE INDEX IF NOT EXISTS idx_publications_company ON publications(company_name);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);
CREATE INDEX IF NOT EXISTS idx_publications_published_at ON publications(published_at);
