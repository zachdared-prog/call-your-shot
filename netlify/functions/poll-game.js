import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

const MLB_BASE = 'https://statsapi.mlb.com/api'
const DODGERS_ID = 119

export default async function handler(req, context) {
  const url = new URL(req.url)
  const gamePk = url.searchParams.get('gamePk')

  if (!gamePk) return Response.json({ error: 'gamePk required' }, { status: 400 })

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

    // Get game record from DB
    const { data: gameRow } = await supabase
      .from('games')
      .select('*')
      .eq('game_pk', parseInt(gamePk))
      .single()

    if (!gameRow) return Response.json({ error: 'Game not in DB' }, { status: 404 })

    // Update game status
    if (gameRow.status !== newStatus) {
      const updates = { status: newStatus }
      if (newStatus === 'active') {
        // Reveal all picks
        await supabase
          .from('picks')
          .update({ is_visible: true })
          .eq('game_id', gameRow.id)
        updates.lineup_locked = true
      }
      await supabase.from('games').update(updates).eq('id', gameRow.id)
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
