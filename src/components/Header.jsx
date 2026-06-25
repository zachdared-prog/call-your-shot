import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

export default function Header() {
  const location = useLocation()
  const [nickname, setNickname] = useState(null)

  useEffect(() => {
    const stored = localStorage.getItem('cys_nickname')
    if (stored) setNickname(stored)
  }, [location])

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="header-logo">
          <div className="logo-badge">
            <span className="logo-la">LA</span>
            <span className="logo-text">Call Your Shot</span>
          </div>
        </Link>
        <nav className="header-nav">
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>Home</Link>
          <Link to="/leaderboard" className={location.pathname === '/leaderboard' ? 'active' : ''}>
            Leaderboard
          </Link>
          {nickname && (
            <span className="header-nickname">
              <span className="nickname-dot" />
              {nickname}
            </span>
          )}
        </nav>
      </div>
    </header>
  )
}
