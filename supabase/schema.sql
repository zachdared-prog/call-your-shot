-- =============================================
-- CALL YOUR SHOT — Supabase Schema
-- Run this in the Supabase SQL Editor
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABLES
-- =============================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nickname TEXT NOT NULL,
  game_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_admin BOOLEAN DEFAULT FALSE,
  UNIQUE (nickname, game_date)
);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_pk INTEGER UNIQUE NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT NOT NULL,
  home_away TEXT NOT NULL CHECK (home_away IN ('home', 'away')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'final', 'postponed')),
  first_pitch_time TIMESTAMPTZ,
  game_number INTEGER DEFAULT 1,
  lineup_locked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS picks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  is_visible BOOLEAN DEFAULT FALSE,
  UNIQUE (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS home_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  inning INTEGER NOT NULL,
  hr_number_in_game INTEGER NOT NULL,
  is_first_of_game BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  points_earned INTEGER DEFAULT 0,
  breakdown JSONB DEFAULT '{}',
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, game_id)
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

-- USERS policies
CREATE POLICY "users_select_all" ON users FOR SELECT USING (true);
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (true);

-- GAMES policies
CREATE POLICY "games_select_all" ON games FOR SELECT USING (true);
CREATE POLICY "games_insert_service" ON games FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "games_update_service" ON games FOR UPDATE TO service_role USING (true);

-- PICKS policies
CREATE POLICY "picks_select_own_or_visible" ON picks FOR SELECT
  USING (
    auth.uid()::TEXT = user_id::TEXT
    OR is_visible = true
  );
CREATE POLICY "picks_insert_own" ON picks FOR INSERT WITH CHECK (true);
CREATE POLICY "picks_update_own" ON picks FOR UPDATE USING (true);
CREATE POLICY "picks_delete_service" ON picks FOR DELETE TO service_role USING (true);

-- HOME_RUNS policies
CREATE POLICY "home_runs_select_all" ON home_runs FOR SELECT USING (true);
CREATE POLICY "home_runs_insert_service" ON home_runs FOR INSERT TO service_role WITH CHECK (true);

-- SCORES policies
CREATE POLICY "scores_select_all" ON scores FOR SELECT USING (true);
CREATE POLICY "scores_insert_service" ON scores FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "scores_update_service" ON scores FOR UPDATE TO service_role USING (true);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX IF NOT EXISTS idx_games_date ON games (game_date);
CREATE INDEX IF NOT EXISTS idx_picks_game ON picks (game_id);
CREATE INDEX IF NOT EXISTS idx_picks_user ON picks (user_id);
CREATE INDEX IF NOT EXISTS idx_home_runs_game ON home_runs (game_id);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores (game_id);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores (user_id);
