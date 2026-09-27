import { useState } from 'react'
import { useActivity, type Activity as Row } from './useActivity.ts'

const KIND_LABEL = { api: 'API', redis: 'Redis', llm: 'LLM', tool: 'Tool', db: 'Postgres', jev: 'Jev', queue: 'Queue' }

const fmtMs = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
const fmtValue = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v))

function Status({ status }: { status: Row['status'] }) {
  if (status === 'start') return <span className="spinner" aria-label="running" />
  return <span className={`status ${status}`} aria-label={status}>{status === 'done' ? '✓' : '✕'}</span>
}

function ActivityRow({ row }: { row: Row }) {
  const karma = row.title === 'get_customer_karma' && row.status === 'done' ? row.result : undefined
  const fields = Object.entries(row.detail ?? {}).filter(([, v]) => v !== undefined && v !== '')
  return (
    <li className={`act act-${row.kind}`}>
      <details>
        <summary>
          <span className="kind">{KIND_LABEL[row.kind]}</span>
          <span className="act-title">{row.title}</span>
          <span className="act-ms">{fmtMs(row.ms)}</span>
          <Status status={row.status} />
          {row.summary && <span className={`act-summary ${row.status}`}>{row.summary}</span>}
          {karma && (
            <span className={`meter tier-${karma.tier}`} title={`karma ${karma.score}`}>
              <span style={{ width: `${karma.score}%` }} />
            </span>
          )}
        </summary>
        <dl className="kv">
          {[...(row.chatId ? [['chat', row.chatId.slice(0, 8)]] : []), ...fields, ['at', new Date(row.startedAt).toLocaleTimeString()]].map(([k, v]) => (
            <div key={String(k)}><dt>{String(k)}</dt><dd>{fmtValue(v)}</dd></div>
          ))}
        </dl>
      </details>
    </li>
  )
}

type Request = { head?: Row; steps: Row[] }

function toRequests(rows: Row[]): Request[] {
  const requests: Request[] = []
  const latest = new Map<string, Request>()
  for (const r of [...rows].reverse()) {
    const chat = r.chatId ?? ''
    let req = latest.get(chat)
    if (r.kind === 'api' || !req) {
      req = { head: r.kind === 'api' ? r : undefined, steps: [] }
      requests.push(req)
      latest.set(chat, req)
    }
    if (r.kind !== 'api') req.steps.push(r)
  }
  return requests.reverse()
}

export default function Activity({ chatId }: { chatId?: string }) {
  const { rows } = useActivity()
  const [all, setAll] = useState(false)
  const shown = all || !chatId ? rows : rows.filter((r) => r.chatId === chatId)
  return (
    <aside className="panel flow">
      <div className="panel-head">
        <h2>Backend flow</h2>
        <span className="live-dot" aria-hidden />
        <div className="seg" role="group" aria-label="Filter">
          <button className={!all && chatId ? 'on' : ''} onClick={() => setAll(false)} disabled={!chatId}>This chat</button>
          <button className={all || !chatId ? 'on' : ''} onClick={() => setAll(true)}>All</button>
        </div>
      </div>
      <ol className="requests">
        {shown.length === 0 && <li className="empty">Nothing yet. Send a message from the customer chat.</li>}
        {toRequests(shown).map(({ head, steps }) => (
          <li key={head?.id ?? steps[0].id} className="request">
            {head && (
              <div className="request-head">
                <span className="act-title">{head.title}</span>
                {typeof head.detail?.text === 'string' && <span className="muted clip">“{head.detail.text}”</span>}
                <span className="act-ms">{fmtMs(head.ms)}</span>
                <Status status={head.status} />
              </div>
            )}
            <ol className="steps">
              {steps.map((r) => <ActivityRow key={r.id} row={r} />)}
              {head?.summary && <li className="response">→ {head.summary}</li>}
            </ol>
          </li>
        ))}
      </ol>
    </aside>
  )
}
