import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE sources (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          format TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          size INTEGER NOT NULL,
          stored_path TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          status TEXT NOT NULL,
          method TEXT NOT NULL,
          extracted_text TEXT NOT NULL DEFAULT '',
          warnings TEXT NOT NULL DEFAULT '[]',
          converted_from_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
          record_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX sources_sha ON sources(sha256);

        CREATE TABLE records (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          lang TEXT NOT NULL,
          data TEXT NOT NULL,
          sources TEXT NOT NULL DEFAULT '[]',
          field_sources TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX records_kind ON records(kind);

        CREATE TABLE applications (
          id TEXT PRIMARY KEY,
          company TEXT NOT NULL,
          role TEXT NOT NULL,
          location TEXT NOT NULL DEFAULT '',
          lang TEXT NOT NULL,
          status TEXT NOT NULL,
          offer_text TEXT NOT NULL DEFAULT '',
          offer_url TEXT NOT NULL DEFAULT '',
          offer_file_name TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          cv_id TEXT,
          base_cv_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          applied_at TEXT
        );

        CREATE TABLE cvs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          lang TEXT NOT NULL,
          application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
          base_cv_id TEXT,
          document TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE cv_versions (
          id TEXT PRIMARY KEY,
          cv_id TEXT NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          document TEXT NOT NULL,
          doc_hash TEXT NOT NULL,
          locked INTEGER NOT NULL DEFAULT 0,
          application_id TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (cv_id, number)
        );

        CREATE TABLE sent_files (
          id TEXT PRIMARY KEY,
          version_id TEXT NOT NULL REFERENCES cv_versions(id),
          kind TEXT NOT NULL,
          filename TEXT NOT NULL,
          stored_path TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        -- Sent versions and their files can never be modified or deleted.
        CREATE TRIGGER cv_versions_no_update_locked BEFORE UPDATE ON cv_versions WHEN OLD.locked = 1
          BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SENT_VERSION'); END;
        CREATE TRIGGER cv_versions_no_delete_locked BEFORE DELETE ON cv_versions WHEN OLD.locked = 1
          BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SENT_VERSION'); END;
        CREATE TRIGGER sent_files_no_update BEFORE UPDATE ON sent_files
          BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SENT_FILE'); END;
        CREATE TRIGGER sent_files_no_delete BEFORE DELETE ON sent_files
          BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SENT_FILE'); END;

        CREATE TABLE app_events (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          at TEXT NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX app_events_app ON app_events(application_id, at);

        CREATE TABLE proposals (
          id TEXT PRIMARY KEY,
          cv_id TEXT NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX proposals_cv ON proposals(cv_id, status);

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          cv_id TEXT NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX messages_cv ON messages(cv_id, created_at);

        CREATE TABLE import_batches (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    description: 'Sent versions keep the application context (offer, notes) as it was when sent',
    up: (db) => {
      db.exec('ALTER TABLE cv_versions ADD COLUMN sent_context TEXT');
    },
  },
];
