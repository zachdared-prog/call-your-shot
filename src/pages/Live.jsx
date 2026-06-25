import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient.js'
import HRTracker from '../components/HRTracker.jsx'

export default function Live() {
  const { gameId } = useParams()
  const [game, setGame] = useState(null)
  const [picks, setPicks] = useState([])
  const [homeRuns, setHomeRuns] = useState([])
  const [users, setUsers] = useState([])
  const [scores, setScores] = useState([])
  const [loading, setLoading] = useState(true)
  const pollRef = useRef(null)

  useEffect(() => {
    loadAll()

    // Real-time subscriptions
    const channel = supabase
      .channel(`live-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'home_runs', filter: `game_id=eq.${gameId}` }, () => loadHomeRuns())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks', filter: `game_id=eq.${gameId}` }, () => loadPicks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `game_id=eq.${gameId}` }, () => loadScores())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, (payload) => {
        setGame(payload.new)
      })
      .subscribe()

    // Poll for HR updates every 90s
    pollRef.current = setInterval(() => {
      if (game?.game_pk) {
        fetch(`/.netlify/functions/poll-game?gamePk=${game.game_pk}`).catch(() => {})
      }
    }, 90000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollRef.current)
    }
  }, [gameId])

  // Re-register poll once game_pk is known
  useEffect(() => {
    if (!game?.game_pk) return
    clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      fetch(`/.netlify/functions/poll-game?gamePk=${game.game_pk}`).catch(() => {})
    }, 90000)
    // Trigger once immediately
    fetch(`/.netlify/functions/poll-game?gamePk=${game.game_pk}`).catch(() => {})
    return () => clearInterval(pollRef.current)
  }, [game?.game_pk])

  async function loadAll() {
    await Promise.all([loadGame(), loadPicks(), loadHomeRuns(), loadUsers(), loadScores()])
    setLoading(false)
  }

  async function loadGame() {
    const { data } = await supabase.from('games').select('*').eq('id', gameId).single()
    if (data) setGame(data)
  }

  async function loadPicks() {
    const { data } = await supabase
      .from('picks')
      .select('*')
      .eq('game_id', gameId)
      .eq('is_visible', true)
    setPicks(data || [])
  }

  async function loadHomeRuns() {
    const { data } = await supabase
      .from('home_runs')
      .select('*')
      .eq('game_id', gameId)
      .order('hr_number_in_game', { ascending: true })
    setHomeRuns(data || [])
  }

  async function loadUsers() {
    const { data } = await supabase.from('users').select('id, nickname')
    setUsers(data || [])
  }

  async function loadScores() {
    const { data } = await supabase.from('scores').select('*').eq('game_id', gameId)
    setScores(data || [])
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state"><div className="spinner" /><p>Loading live game…</p></div>
      </div>
    )
  }

  if (!game) return <div className="page"><div className="error-banner">Game not found.</div></div>

  if (game.status === 'final') {
    return (
      <div className="page">
        <div className="status-message">
          Game is over. <Link to={`/results/${gameId}`}>View Final Results →</Link>
        </div>
      </div>
    )
  }

  const userMap = {}
  users.forEach(u => { userMap[u.id] = u.nickname })

  const scoreMap = {}
  scores.forEach(s => { scoreMap[s.user_id] = s })

  const myId = localStorage.getItem('cys_user_id')

  return (
    <div className="page page--live">
      <div className="live-header">
        <div className="live-badge">🔴 LIVE</div>
        <h1 className="page-title">
          LAD {game.home_away === 'home' ? 'vs' : '@'} {game.opponent}
        </h1>
      </div>

      <div className="live-grid">
        <div className="live-left">
          <HRTracker homeRuns={homeRuns} picks={picks} users={users} />
        </div>

        <div className="live-right">
          <div className="picks-board">
            <h2 className="board-title">All Picks</h2>
            {picks.length === 0 ? (
              <p className="board-empty">Picks will appear here once the game starts.</p>
            ) : (
              <div className="picks-list">
                {picks.map(pick => {
                  const isMe = pick.user_id === myId
                  const score = scoreMap[pick.user_id]
                  return (
                    <div key={pick.id} className={`pick-row ${isMe ? 'pick-row--me' : ''}`}>
                      <div className="pick-row-left">
                        <span className="pick-nickname">{userMap[pick.user_id] || '?'}</span>
                        {isMe && <span className="you-badge">YOU</span>}
                      </div>
                      <div className="pick-row-right">
                        <span className="pick-player">{pick.player_name}</span>
                        {score && (
                          <span className="pick-score">{score.points_earned} pts</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
