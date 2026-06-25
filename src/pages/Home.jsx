import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import GameCard from '../components/GameCard.jsx'

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

export default function Home() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [userPicks, setUserPicks] = useState({})
  const [userId, setUserId] = useState(null)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    initUser()
    fetchGames()

    const channel = supabase
      .channel('games-home')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        fetchGames()
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function initUser() {
    const stored = localStorage.getItem('cys_user_id')
    if (stored) {
      setUserId(stored)
      return
    }
    // No user yet — will be created on pick submission
  }

  async function fetchGames() {
    setLoading(true)
    try {
      // Trigger server-side game fetch/upsert
      const res = await fetch('/.netlify/functions/get-todays-games')
      if (res.ok) {
        const data = await res.json()
        if (data.games?.length) {
          setGames(data.games)
          await fetchUserPicks(data.games)
          setLoading(false)
          return
        }
      }
    } catch (e) {
      // Fall through to direct DB query
    }

    // Fall back to direct Supabase query
    const today = todayDate()
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('game_date', today)
      .order('first_pitch_time', { ascending: true })

    if (error) setError(error.message)
    else {
      setGames(data || [])
      await fetchUserPicks(data || [])
    }
    setLoading(false)
  }

  async function fetchUserPicks(gamesList) {
    const uid = localStorage.getItem('cys_user_id')
    if (!uid || !gamesList.length) return

    const gameIds = gamesList.map(g => g.id)
    const { data } = await supabase
      .from('picks')
      .select('*')
      .eq('user_id', uid)
      .in('game_id', gameIds)

    const map = {}
    data?.forEach(p => { map[p.game_id] = p })
    setUserPicks(map)
  }

  async function refreshGames() {
    setFetching(true)
    await fetchGames()
    setFetching(false)
  }

  if (loading) {
    return (
      <div className="page page--home">
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading today's game…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page page--home">
      <div className="home-hero">
        <h1 className="hero-title">Call Your Shot</h1>
        <p className="hero-sub">Pick the Dodger who hits the first homer. Prove you know ball.</p>
      </div>

      <div className="home-content">
        {error && <div className="error-banner">{error}</div>}

        {games.length === 0 ? (
          <div className="no-game-state">
            <div className="no-game-icon">⚾</div>
            <h2>No Dodger game today</h2>
            <p>Check the leaderboard to see how everyone's doing this season.</p>
            <a href="/leaderboard" className="btn btn--primary">View Leaderboard</a>
          </div>
        ) : (
          <>
            <div className="section-header">
              <h2 className="section-title">Today's Game{games.length > 1 ? 's' : ''}</h2>
              <button className="btn btn--sm btn--ghost" onClick={refreshGames} disabled={fetching}>
                {fetching ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>
            <div className="games-list">
              {games.map(game => (
                <GameCard
                  key={game.id}
                  game={game}
                  userPick={userPicks[game.id]}
                  hasPick={!!userPicks[game.id]}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
