# Call Your Shot 🏟️

A pick'em app for 4–8 friends to predict which LA Dodgers player hits the first home run in each game. Built for the 2025 MLB season.

## Setup

### 1. Run the Supabase schema

1. Go to your [Supabase project](https://supabase.com) → SQL Editor
2. Paste and run the contents of `supabase/schema.sql`

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_SECRET=your-admin-password
```

### 3. Install and run locally

```bash
npm install
npm run dev
```

### 4. Deploy to Netlify

1. Push this repo to GitHub
2. Connect to Netlify → New site from Git
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add all four environment variables in Netlify → Site Settings → Environment Variables

## How it works

- **Nicknames** are first-come-first-served per game day, stored in localStorage
- **Picks lock** 5 minutes before first pitch
- **All picks are hidden** until the game goes active (admin clicks "Mark as Started" or the poller detects it)
- **Scoring**: 5 pts for picking the first HR, +1 pt for each additional HR by your player

## Routes

| Route | Description |
|-------|-------------|
| `/` | Home — today's game(s) + pick status |
| `/pick/:gameId` | Submit or change your pick |
| `/live/:gameId` | Live game view with HR tracker |
| `/results/:gameId` | Final results & scoreboard |
| `/leaderboard` | Season totals |
| `/admin` | Admin panel (password protected) |

## Admin Panel

Go to `/admin` and enter the `ADMIN_SECRET` password. From there you can:
- View all picks (including hidden ones)
- Mark game as Started / Postponed / Final
- Manually add a home run
- Recalculate scores

## Netlify Functions

| Function | Purpose |
|----------|---------|
| `get-todays-games` | Fetches today's Dodgers game from MLB API, upserts to DB |
| `get-lineup` | Returns batting order or 40-man roster fallback |
| `poll-game` | Detects new HRs from live feed, triggers scoring |
| `calculate-scores` | Scores all picks for a game |
| `admin-override` | Admin actions (start/postpone/add HR/recalculate) |
