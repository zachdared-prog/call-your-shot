import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient.js'
import PlayerCard from '../components/PlayerCard.jsx'

export default function Pick() {
  const { gameId } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState(null)
  const [lineup, setLineup] = useState([])
  const [lineupConfirmed, setLineupConfirmed] = useState(false)
  const [selected, setSelected] = useState(null)
  const [nickname, setNickname] = useState('')
  const [existingNickname, setExistingNickname] = useState(null)
  const [existingPick, setExistingPick] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [locked, setLocked] = useState(false)
  const [timeLeft, setTimeLeft] = useState(null)

  useEffect(() => {
    loadGame()
    const stored = localStorage.getItem('cys_nickname')
    if (stored) setExistingNickname(stored)
  }, [gameId])

  useEffect(() => {
    if (!game) return
    const uid = localStorage.getItem('cys_user_id')
    if (uid) loadExistingPick(uid)
    checkLock()
    const interval = setInterval(checkLock, 10000)
    return () => clearInterval(interval)
  }, [game])

  async function loadGame() {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single()

    if (error || !data) {
      setError('Game not found.')
      setLoading(false)
      return
    }
    setGame(data)
    await loadLineup(data.game_pk)
    setLoading(false)
  }

  async function loadLineup(gamePk) {
    try {
      const res = await fetch(`/.netlify/functions/get-lineup?gamePk=${gamePk}`)
      if (res.ok) {
        const data = await res.json()
        setLineup(data.players || [])
        setLineupConfirmed(data.lineup_confirmed || false)
        return
      }
    } catch (e) {}
    // Fallback: fetch 40-man roster
    try {
      const res = await fetch('https://statsapi.mlb.com/api/v1/teams/119/roster?rosterType=40Man')
      const data = await res.json()
      const players = (data.roster || []).map(p => ({
        player_id: p.person.id,
        player_name: p.person.fullName,
        position: p.position?.abbreviation || '',
        jersey_number: p.jerseyNumber || '',
      }))
      setLineup(players)
      setLineupConfirmed(false)
    } catch (e) {
      setError('Could not load lineup. Try refreshing.')
    }
  }

  async function loadExistingPick(uid) {
    const { data } = await supabase
      .from('picks')
      .select('*')
      .eq('user_id', uid)
      .eq('game_id', gameId)
      .maybeSingle()

    if (data) {
      setExistingPick(data)
      setSelected({ player_id: data.player_id, player_name: data.player_name })
    }
  }

  function checkLock() {
    if (!game?.first_pitch_time) return
    const now = new Date()
    const pitch = new Date(game.first_pitch_time)
    const diff = pitch - now
    const fiveMin = 5 * 60 * 1000
    setLocked(diff <= fiveMin || game.lineup_locked)
    if (diff > 0 && diff <= fiveMin) {
      setTimeLeft(Math.max(0, Math.floor(diff / 1000)))
    }
  }

  async function handleSubmit() {
    if (!selected) return setError('Please select a player.')
    const nick = existingNickname || nickname.trim()
    if (!nick) return setError('Please enter a nickname.')

    setSubmitting(true)
    setError(null)

    let uid = localStorage.getItem('cys_user_id')

    // Upsert user
    if (!uid) {
      const today = new Date().toISOString().slice(0, 10)
      // Try to find existing user with this nickname today
      const { data: existing } = await supabase
        .from('users')
        .select('id, nickname')
        .eq('nickname', nick)
        .eq('game_date', today)
        .maybeSingle()

      if (existing) {
        setError(`Nickname "${nick}" is already taken for today. Choose another.`)
        setSubmitting(false)
        return
      }

      const { data: newUser, error: userErr } = await supabase
        .from('users')
        .insert({ nickname: nick, game_date: today })
        .select()
        .single()

      if (userErr) {
        setError('Could not create user. Try a different nickname.')
        setSubmitting(false)
        return
      }
      uid = newUser.id
      localStorage.setItem('cys_user_id', uid)
      localStorage.setItem('cys_nickname', nick)
      setExistingNickname(nick)
    }

    // Upsert pick
    const { error: pickErr } = await supabase
      .from('picks')
      .upsert({
        user_id: uid,
        game_id: gameId,
        player_id: selected.player_id,
        player_name: selected.player_name,
        submitted_at: new Date().toISOString(),
        is_visible: false,
      }, { onConflict: 'user_id,game_id' })

    if (pickErr) {
      setError('Failed to submit pick: ' + pickErr.message)
      setSubmitting(false)
      return
    }

    navigate('/')
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-state"><div className="spinner" /><p>Loading lineup…</p></div>
      </div>
    )
  }

  if (!game) return <div className="page"><div className="error-banner">{error || 'Game not found.'}</div></div>

  if (game.status === 'postponed') {
    return (
      <div className="page">
        <div className="status-message postponed">Game has been postponed.</div>
      </div>
    )
  }

  if (game.status === 'final' || game.status === 'active') {
    return (
      <div className="page">
        <div className="status-message">
          {game.status === 'active' ? 'Game is in progress. ' : 'Game is over. '}
          <a href={`/${game.status === 'active' ? 'live' : 'results'}/${game.id}`}>
            View {game.status === 'active' ? 'Live Feed' : 'Results'}
          </a>
        </div>
      </div>
    )
  }

  const homeAway = game.home_away === 'home' ? 'vs' : '@'

  return (
    <div className="page page--pick">
      <div className="pick-header">
        <h1 className="page-title">Make Your Pick</h1>
        <div className="pick-matchup">LAD {homeAway} {game.opponent}</div>
        {!lineupConfirmed && (
          <div className="lineup-notice">
            ⚠️ Official lineup not yet posted — showing 40-man roster
          </div>
        )}
        {lineupConfirmed && (
          <div className="lineup-confirmed">✓ Official batting order</div>
        )}
      </div>

      {locked ? (
        <div className="locked-state">
          <div className="lock-icon">🔒</div>
          <h2>Picks are locked</h2>
          <p>The pick window has closed for this game.</p>
          {existingPick && (
            <p>Your pick: <strong>{existingPick.player_name}</strong></p>
          )}
        </div>
      ) : (
        <>
          {!existingNickname && (
            <div className="nickname-section">
              <label className="form-label" htmlFor="nickname">Your Nickname</label>
              <input
                id="nickname"
                className="form-input"
                type="text"
                placeholder="e.g. BigBlueZach"
                maxLength={20}
                value={nickname}
                onChange={e => setNickname(e.target.value)}
              />
              <p className="form-hint">First-come-first-served. You'll keep this name all season.</p>
            </div>
          )}

          {existingNickname && (
            <div className="nickname-display">
              Playing as <strong>{existingNickname}</strong>
            </div>
          )}

          <div className="player-grid-label">
            Who hits the first homer? {lineup.length > 0 && `(${lineup.length} players)`}
          </div>

          <div className="player-grid">
            {lineup.map(player => (
              <PlayerCard
                key={player.player_id}
                player={player}
                selected={selected?.player_id === player.player_id}
                onSelect={setSelected}
                disabled={false}
              />
            ))}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="pick-submit-row">
            {selected && (
              <div className="selected-summary">
                Selected: <strong>{selected.player_name}</strong>
              </div>
            )}
            <button
              className="btn btn--primary btn--lg"
              onClick={handleSubmit}
              disabled={submitting || !selected}
            >
              {submitting ? 'Submitting…' : existingPick ? 'Update Pick' : 'Lock In My Pick'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
