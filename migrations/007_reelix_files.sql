CREATE INDEX IF NOT EXISTS stored_files_source_created_idx
  ON stored_files (source, created_at DESC);

CREATE INDEX IF NOT EXISTS stored_files_mimetype_created_idx
  ON stored_files (mimetype, created_at DESC);
