import { useEffect, useRef, useState } from 'react'
import Activity from './Activity.tsx'
import { api, useActivity } from './useActivity.ts'

type Evidence = { tool: string; imageId: string; result: Record<string, any> }
type Verdict = 'genuine' | 'fake' | 'low_confidence'
type Report = {
  recommendation: string
  risk: 'low' | 'medium' | 'high'
  summary: string
  issue: string
  clientId: string
  customerName: string
  karma: { score: number; tier: 'trusted' | 'normal' | 'watch' }
  images: { id: string; thumb: string }[]
  evidence: Evidence[]
  review?: { verdict: Verdict; karmaBefore: number; karmaAfter: number }
}
type Chat = {
  chatId: string
  clientId?: string
  startedAt?: number
  messages: { role: 'user' | 'assistant'; content: string; imageIds?: string[] }[]
  report?: Report
}

const VERDICTS: { id: Verdict; label: string }[] = [
  { id: 'genuine', label: 'Genuine' },
  { id: 'fake', label: 'Fake' },
  { id: 'low_confidence', label: 'Low confidence' },
]
const TOOL_LABELS: Record<string, string> = {
  get_image_metadata: 'Metadata',
  rate_image_similarity: 'Similarity',
  check_ai_generated: 'AI check',
}
const label = (s: string) => s.replaceAll('_', ' ')
const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

function describe({ tool, result: r }: Evidence): string {
  if (r.error) return `⚠️ ${r.error}`
  if (tool === 'get_image_metadata') {
    if (!r.hasMetadata) return 'No EXIF metadata'
    return [
      r.camera,
      r.takenAt && `taken ${new Date(r.takenAt).toLocaleDateString()}`,
      r.takenAfterOrder === false && '⚠️ before order',
      r.editedWith && `⚠️ edited with ${r.editedWith}`,
    ].filter(Boolean).join(' · ')
  }
  if (tool === 'rate_image_similarity') return r.raw ?? `${r.similarity}% match · ${r.observed}`
  if (tool === 'check_ai_generated') return `${Math.round(r.aiGenerated * 100)}% likely AI-generated`
  return JSON.stringify(r)
}

function ReportCard({ report }: { report: Report }) {
  return (
    <section className={`report risk-${report.risk}`}>
      <div className="report-head">
        <div>
          <div className="eyebrow">{report.customerName} · {report.clientId}</div>
          <strong>{report.issue}</strong>
        </div>
        <div className="chips">
          <span className={`chip tier-${report.karma.tier}`}>Karma {report.karma.score} · {report.karma.tier}</span>
          <span className="chip risk">Risk {report.risk}</span>
          <span className="chip strong">{label(report.recommendation)}</span>
        </div>
      </div>
      <p>{report.summary}</p>
      {report.images.map((img) => (
        <div key={img.id} className="evidence">
          <img src={img.thumb} alt={img.id} />
          <dl>
            {report.evidence.filter((e) => e.imageId === img.id).map((e) => (
              <div key={e.tool}>
                <dt>{TOOL_LABELS[e.tool] ?? e.tool}</dt>
                <dd>
                  <details>
                    <summary>{describe(e)}</summary>
                    <pre>{JSON.stringify(e.result, null, 2)}</pre>
                  </details>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}

function ReviewBar({ chatId, report }: { chatId: string; report: Report }) {
  const [pending, setPending] = useState<Verdict>()
  const [error, setError] = useState<string>()
  const review = report.review

  async function submit(verdict: Verdict) {
    setPending(verdict)
    setError(undefined)
    try {
      const res = await fetch(api('/review'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, verdict }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${res.status}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setPending(undefined)
    }
  }

  if (review) {
    const delta = review.karmaAfter - review.karmaBefore
    return (
      <div className="review-bar done">
        <span>Marked <strong>{label(review.verdict)}</strong></span>
        <span className="muted">Karma {review.karmaBefore} → <strong className={delta < 0 ? 'down' : ''}>{review.karmaAfter}</strong></span>
      </div>
    )
  }
  return (
    <div className="review-bar">
      <span className="muted">Your verdict</span>
      <div className="verdicts">
        {VERDICTS.map((v) => (
          <button key={v.id} className={`verdict v-${v.id}`} disabled={!!pending} onClick={() => submit(v.id)}>
            {pending === v.id ? '…' : v.label}
          </button>
        ))}
      </div>
      {error && <span className="error-text">{error}</span>}
    </div>
  )
}

export default function Agent() {
  const [chats, setChats] = useState<Chat[]>([])
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState<string>()
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch(api('/customers')).then((r) => r.json())
      .then((cs: { clientId: string; name: string }[]) => setNames(Object.fromEntries(cs.map((c) => [c.clientId, c.name]))))
      .catch(() => {})
  }, [])
  const { writes } = useActivity()

  useEffect(() => {
    let alive = true
    const loadAll = () => fetch(api('/chats'))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: Chat[]) => { if (alive) { setChats(data); setError(undefined) } })
      .catch((err) => { if (alive) setError(String(err)) })
    loadAll()
    const timer = setInterval(loadAll, 5 * 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const [pending, setPending] = useState(writes)
  const lastRefresh = useRef(0)
  useEffect(() => {
    const timer = setTimeout(() => { lastRefresh.current = Date.now(); setPending(writes) }, Math.max(0, lastRefresh.current + 1000 - Date.now()))
    return () => clearTimeout(timer)
  }, [writes])

  const seen = useRef<Record<string, number>>({})
  useEffect(() => {
    const changed = Object.keys(pending).filter((id) => pending[id] !== seen.current[id])
    seen.current = pending
    for (const id of changed) {
      fetch(api(`/chats/${id}`))
        .then((res) => (res.status === 404 ? undefined : res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((c: Chat | undefined) => setChats((prev) =>
          [...prev.filter((x) => x.chatId !== id), ...(c ? [c] : [])]
            .sort((x, y) => (x.startedAt ?? Infinity) - (y.startedAt ?? Infinity))))
        .catch((err) => setError(String(err)))
    }
  }, [pending])

  const chat = chats.find((c) => c.chatId === selected)

  return (
    <>
      <main className="panel phone agent">
        {!chat ? (
          <>
            <div className="panel-head">
              <h2>Support queue</h2>
              <span className="count">{chats.length}</span>
              {error && <span className="error-text">{error}</span>}
            </div>
            <ul className="chat-list">
              {chats.length === 0 && <li className="empty">No chats yet. Messages from the customer chat appear here.</li>}
              {chats.map((c, n) => {
                const lastUser = c.messages.findLast((m) => m.role === 'user')
                return (
                  <li key={c.chatId}>
                    <button onClick={() => setSelected(c.chatId)}>
                      <span className="row">
                        <span className="who">
                          <span className="pos">{n + 1}</span>
                          <strong>{c.report?.customerName ?? names[c.clientId ?? ''] ?? 'Guest'}</strong>
                          {c.report && <span className={`dot risk-${c.report.risk}`} title={`risk: ${c.report.risk}`} />}
                        </span>
                        <time className="tag" dateTime={c.startedAt ? new Date(c.startedAt).toISOString() : undefined} title="Issue raised at">{clock(c.startedAt)}</time>
                      </span>
                      <span className="muted clip">{c.report?.issue ?? lastUser?.content ?? '—'}</span>
                      {c.report?.review && <span className="tag">Reviewed · {label(c.report.review.verdict)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <>
            <div className="panel-head">
              <button className="back" onClick={() => setSelected(undefined)} aria-label="Back to inbox">←</button>
              <strong>{chat.report?.customerName ?? names[chat.clientId ?? ''] ?? 'Guest'}</strong>
              {chat.startedAt && <span className="tag">since {clock(chat.startedAt)}</span>}
              {chat.report && <span className={`dot risk-${chat.report.risk}`} title={`risk: ${chat.report.risk}`} />}
            </div>
            <ul className="messages" aria-live="polite">
              {chat.report && <li className="card-slot"><ReportCard report={chat.report} /></li>}
              {chat.messages.map((m, i) => (
                <li key={i} className={m.role}>
                  {m.content}
                  {m.imageIds && <em>{'\n'}📎 {m.imageIds.join(', ')}</em>}
                </li>
              ))}
            </ul>
            {chat.report && <ReviewBar key={chat.chatId} chatId={chat.chatId} report={chat.report} />}
          </>
        )}
      </main>
      <Activity chatId={chat?.chatId} />
    </>
  )
}
