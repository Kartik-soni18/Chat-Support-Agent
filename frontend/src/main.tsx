import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Agent from './Agent.tsx'
import App from './App.tsx'
import { connect } from './useActivity.ts'

const support = location.pathname.startsWith('/support')
const chatId = crypto.randomUUID()
connect(support ? '/events' : `/events?chatId=${chatId}`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="page">
      <nav className="topbar">
        <a href="/" aria-current={support ? undefined : 'page'}>Customer chat</a>
        <a href="/support" aria-current={support ? 'page' : undefined}>Support desk</a>
      </nav>
      <div className="screens">{support ? <Agent /> : <App chatId={chatId} />}</div>
    </div>
  </StrictMode>,
)
