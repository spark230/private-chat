-- ═══════════════════════════════════════════════════════════════
-- PRIVATE CHAT — Supabase Setup
-- Run this ENTIRE script in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- 1. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT 'text',        -- 'text' or 'image'
  sender      TEXT NOT NULL,
  text        TEXT,
  image_url   TEXT,
  image_path  TEXT,                                 -- storage path for download
  caption     TEXT DEFAULT '',
  is_edited   BOOLEAN DEFAULT FALSE,
  edited_at   TIMESTAMPTZ,
  seen        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ROW LEVEL SECURITY (permissive — private chat, no auth needed)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all reads"
  ON messages FOR SELECT
  USING (true);

CREATE POLICY "Allow all inserts"
  ON messages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow all updates"
  ON messages FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all deletes"
  ON messages FOR DELETE
  USING (true);

-- 3. ENABLE REALTIME (so Postgres Changes work on this table)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- 4. STORAGE BUCKET FOR IMAGES
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-images',
  'chat-images',
  true,
  52428800,  -- 50 MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']
) ON CONFLICT (id) DO NOTHING;

-- 5. STORAGE POLICIES
CREATE POLICY "Anyone can view images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-images');

CREATE POLICY "Anyone can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-images');

-- ═══════════════════════════════════════════════════════════════
-- ✅ Done! Your database and storage are ready.
-- ═══════════════════════════════════════════════════════════════

