-- Supabase Database Schema for TeleMarketer Pro

-- 1. Users Table (Core profiles and settings)
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  is_admin BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  auto_reply_enabled BOOLEAN DEFAULT FALSE,
  branding_disabled BOOLEAN DEFAULT FALSE,
  total_sent INTEGER DEFAULT 0,
  total_groups INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  templates JSONB DEFAULT '[]',
  auto_reply_rules JSONB DEFAULT '{}',
  branding_initialized JSONB DEFAULT '[]',
  last_captcha_at TIMESTAMP WITH TIME ZONE,
  has_started_logger BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Accounts Table (Linked Telegram Account Sessions)
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  string_session TEXT NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, account_id)
);

-- 3. License Keys Table (Access control)
CREATE TABLE IF NOT EXISTS license_keys (
  key TEXT PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expiry TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Disable RLS for Prototyping (IMPORTANT: Only for fast setup)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE license_keys DISABLE ROW LEVEL SECURITY;

-- OPTIONAL: Indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_license_keys_user_id ON license_keys(user_id);

-- Instructions:
-- 1. Go to your Supabase Dashboard -> SQL Editor.
-- 2. Paste the code above and click "Run".
-- 3. Copy your project URL and Service Role Key (or Anon Key).
-- 4. Add them to your environment variables in AI Studio as SUPABASE_URL and SUPABASE_ANON_KEY.
