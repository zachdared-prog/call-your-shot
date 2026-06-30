import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

const MLB_BASE = 'https://statsapi.mlb.com/api'
const DODGERS_ID = 119

function getPacificDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

async function findTodaysGamePk() {
  const today = getPacificDate()
  const res = await fetch(
    `${MLB_BASE}/v1/schedule?teamId=${DODGERS_ID}&sportId=1&date=${today}&gameType=R&hydrate=team`
  )
  const data = await res.json()
  for (const date of (data.dates || [])) {
    for (const game of (date.games || [])) {
      const hasDodgers = game.teams.home.team.id === DODGERS_ID || game.teams.away.team.id === DODGERS_ID
      if (hasDodgers) return { gamePk: game.gamePk, gameDate: today }
    }
  }
  return null
}

export default async function handler(req, context) {
  const url = new URL(req.url)
  let gamePk = url.searchParams.get('gamePk')
  let gameDate = null

  if (!gamePk) {
    const found = await findTodaysGamePk()
    if (!found) return Response.json({ error: 'No Dodgers game found today' }, { status: 404 })
    gamePk = found.gamePk
    gameDate = found.gameDate
  }

  try {
    const res = await fetch(`${MLB_BASE}/v1.1/game/${gamePk}/feed/live`)
    const feed = await res.json()

    const abstract = feed?.gameData?.status?.abstractGameState
    const detailed = feed?.gameData?.status?.detailedState || ''

    // Determine game status
    let newStatus = 'scheduled'
    if (abstract === 'Live') newStatus = 'active'
    else if (abstract === 'Final') newStatus = 'final'
    else if (detailed.toLowerCase().includes('postpone')) newStatus = 'postponed'

    // Get or create game record in DB
    let { data: gameRow } = await supabase
      .from('games')
      .select('*')
      .eq('game_pk', parseInt(gamePk))
      .maybeSingle()

    if (!gameRow) {
      const gd = feed?.gameData
      const isHome = gd?.teams?.home?.id === DODGERS_ID
      const opponent = isHome
        ? gd?.teams?.away?.abbreviation
        : gd?.teams?.home?.abbreviation
      const today = gameDate || getPacificDate()
      const { data: inserted } = await supabase
        .from('games')
        .insert({
          game_pk: parseInt(gamePk),
          game_date: today,
          opponent: opponent || 'UNK',
          home_away: isHome ? 'home' : 'away',
          status: newStatus,
          first_pitch_time: gd?.datetime?.dateTime || null,
          game_number: feed?.gameData?.game?.gameNumber || 1,
        })
        .select()
        .single()
      if (!inserted) return Response.json({ error: 'Could not create game record' }, { status: 500 })
      gameRow = inserted
    }

    if (gameRow.status !== newStatus) {
      await supabase.from('games').update({ status: newStatus }).eq('id', gameRow.id)
    }

    if (newStatus === 'active' && !gameRow.lineup_locked) {
      await supabase.from('games').update({ lineup_locked: true }).eq('id', gameRow.id)
      await supabase.from('picks').update({ is_visible: true }).eq('game_id', gameRow.id)
    }

    // Parse play-by-play for home runs
    const allPlays = feed?.liveData?.plays?.allPlays || []
    const gameData = feed?.gameData
    const homeId = gameData?.teams?.home?.id
    const awayId = gameData?.teams?.away?.id

    const existingHRs = await supabase
      .from('home_runs')
      .select('player_id, inning, hr_number_in_game')
      .eq('game_id', gameRow.id)

    const existingKeys = new Set(
      (existingHRs.data || []).map(hr => `${hr.player_id}-${hr.inning}-${hr.hr_number_in_game}`)
    )

    const newHRs = []
    let dodgerHRCount = 0

    for (const play of allPlays) {
      if (play.result?.eventType !== 'home_run') continue

      const battingTeamId = play.about?.halfInning === 'top'
        ? awayId
        : homeId

      if (battingTeamId !== DODGERS_ID) continue

      dodgerHRCount++
      const playerId = play.matchup?.batter?.id
      const playerName = play.matchup?.batter?.fullName || 'Unknown'
      const inning = play.about?.inning || 0
      const hrNumber = dodgerHRCount

      const key = `${playerId}-${inning}-${hrNumber}`
      if (existingKeys.has(key)) continue

      newHRs.push({
        game_id: gameRow.id,
        player_id: playerId,
        player_name: playerName,
        inning,
        hr_number_in_game: hrNumber,
        is_first_of_game: hrNumber === 1,
        detected_at: new Date().toISOString(),
      })
    }

    if (newHRs.length > 0) {
      await supabase.from('home_runs').insert(newHRs)
      // Trigger score calculation
      await fetch(`${getBaseUrl(req)}/calculate-scores?gameId=${gameRow.id}`)
    }

    if (newStatus === 'final') {
      await fetch(`${getBaseUrl(req)}/calculate-scores?gameId=${gameRow.id}`)
    }

    return Response.json({
      status: newStatus,
      newHRs: newHRs.length,
      gameId: gameRow.id,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

function getBaseUrl(req) {
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}/.netlify/functions`
}
