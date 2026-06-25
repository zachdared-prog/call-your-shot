const MLB_BASE = 'https://statsapi.mlb.com/api'
const DODGERS_ID = 119

export default async function handler(req, context) {
  const url = new URL(req.url)
  const gamePk = url.searchParams.get('gamePk')

  if (!gamePk) {
    return Response.json({ error: 'gamePk required' }, { status: 400 })
  }

  try {
    const res = await fetch(`${MLB_BASE}/v1.1/game/${gamePk}/feed/live`)
    const data = await res.json()

    const boxscore = data?.liveData?.boxscore
    if (!boxscore) throw new Error('No boxscore data')

    const gameData = data?.gameData
    const homeId = gameData?.teams?.home?.id
    const dodgersSide = homeId === DODGERS_ID ? 'home' : 'away'

    const teamBox = boxscore.teams?.[dodgersSide]
    const battingOrder = teamBox?.battingOrder || []
    const players = teamBox?.players || {}

    if (battingOrder.length > 0) {
      const lineup = battingOrder.map(id => {
        const pKey = `ID${id}`
        const p = players[pKey]
        return {
          player_id: id,
          player_name: p?.person?.fullName || `Player ${id}`,
          position: p?.position?.abbreviation || '',
          jersey_number: p?.jerseyNumber || '',
          batting_order: p?.battingOrder || null,
        }
      })
      return Response.json({ players: lineup, lineup_confirmed: true })
    }

    // Fall back to 40-man roster
    const rosterRes = await fetch(`${MLB_BASE}/v1/teams/${DODGERS_ID}/roster?rosterType=40Man`)
    const rosterData = await rosterRes.json()
    const roster = (rosterData.roster || []).map(p => ({
      player_id: p.person.id,
      player_name: p.person.fullName,
      position: p.position?.abbreviation || '',
      jersey_number: p.jerseyNumber || '',
    }))

    return Response.json({ players: roster, lineup_confirmed: false })
  } catch (err) {
    // Last resort: 40-man roster
    try {
      const rosterRes = await fetch(`${MLB_BASE}/v1/teams/${DODGERS_ID}/roster?rosterType=40Man`)
      const rosterData = await rosterRes.json()
      const roster = (rosterData.roster || []).map(p => ({
        player_id: p.person.id,
        player_name: p.person.fullName,
        position: p.position?.abbreviation || '',
        jersey_number: p.jerseyNumber || '',
      }))
      return Response.json({ players: roster, lineup_confirmed: false })
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }
  }
}
