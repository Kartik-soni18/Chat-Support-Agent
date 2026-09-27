import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, useActivity, waitForReply } from './useActivity.ts'

type Message = { role: 'user' | 'assistant' | 'error'; text: string; images?: string[] }
type OrderData = {
  order: { id: string; restaurant: string; items: { id: string; name: string; qty: number; price: number }[] }
  images: { id: string; thumb: string }[]
}

const TOOL_STEPS: Record<string, string> = {
  get_customer_karma: 'Reviewing your account',
  get_image_metadata: 'Reading photo details',
  rate_image_similarity: 'Comparing photos with your order',
  check_ai_generated: 'Checking photo authenticity',
  publish_report: 'Sending a summary to our team',
}

function Progress({ chatId }: { chatId: string }) {
  const { rows } = useActivity()
  const [before] = useState(() => new Set(rows.map((r) => r.id)))
  const steps = new Map<string, boolean>()
  for (const r of [...rows].reverse()) {
    if (before.has(r.id) || r.chatId !== chatId || r.kind !== 'tool' || !TOOL_STEPS[r.title]) continue
    const lbl = TOOL_STEPS[r.title]
    steps.set(lbl, (steps.get(lbl) ?? true) && r.status !== 'start')
  }
  return (
    <li className="assistant progress">
      <span>{steps.size ? 'Looking into it' : 'Typing'}<span className="dots" /></span>
      {[...steps].map(([lbl, done]) => (
        <span key={lbl} className={`check ${done ? 'done' : ''}`}>{done ? <span className="tick">✓</span> : <span className="spinner" />} {lbl}</span>
      ))}
    </li>
  )
}

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
  </svg>
)
const PauseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)

export default function App({ chatId }: { chatId: string }) {
  const [data, setData] = useState<OrderData>()
  const [customers, setCustomers] = useState<{ clientId: string; name: string }[]>([])
  const [clientId, setClientId] = useState('CUST-1001')
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: 'What went wrong with this order?' }])
  const [photos, setPhotos] = useState<string[]>([])
  const [attaching, setAttaching] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [mic, setMic] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const recorder = useRef<MediaRecorder>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const say = (...m: Message[]) => setMessages((prev) => [...prev, ...m])

  useEffect(() => {
    fetch(api('/order')).then((r) => r.json()).then(setData)
      .catch((err) => say({ role: 'error', text: `Could not load order: ${err}` }))
    fetch(api('/customers')).then((r) => r.json()).then(setCustomers).catch(() => {})
  }, [])

  useEffect(() => {
    const list = listRef.current
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, attaching])

  const toggle = (id: string) => setPhotos((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  async function toggleMic() {
    if (mic === 'recording') return recorder.current?.stop()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      return say({ role: 'error', text: `Microphone unavailable: ${err}` })
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setMic('transcribing')
      try {
        const res = await fetch(api('/transcribe'), { method: 'POST', headers: { 'Content-Type': rec.mimeType }, body: new Blob(chunks, { type: rec.mimeType }) })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${res.status}`)
        if (json.text) setInput((prev) => (prev.trim() ? `${prev.trim()} ${json.text}` : json.text))
      } catch (err) {
        say({ role: 'error', text: `Could not transcribe: ${err}` })
      } finally {
        setMic('idle')
      }
    }
    rec.start()
    recorder.current = rec
    setMic('recording')
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if ((!text && !photos.length) || loading) return
    say({ role: 'user', text, images: data?.images.filter((i) => photos.includes(i.id)).map((i) => i.thumb) })
    setInput('')
    setPhotos([])
    setAttaching(false)
    setLoading(true)
    try {
      const res = await fetch(api('/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, clientId, text, imageIds: photos }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${res.status}`)
      say({ role: 'assistant', text: await waitForReply(json.jobId) })
    } catch (err) {
      say({ role: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const order = data?.order
  return (
    <main className="panel phone">
      <div className="panel-head">
        <h2>Customer</h2>
        <label className="picker">
          <span className="muted">Ordering as</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={messages.length > 1 || !customers.length}>
            {customers.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
            {!customers.length && <option>{clientId}</option>}
          </select>
        </label>
      </div>
      <ul className="messages" aria-live="polite" ref={listRef}>
        {order && (
          <li className="order-card">
            <strong>{order.restaurant}</strong>
            <small>{order.id}</small>
            {order.items.map((i) => (
              <div key={i.id}><span>{i.qty}× {i.name}</span><span>₹{i.price}</span></div>
            ))}
            <div className="total"><span>Total</span><span>₹{order.items.reduce((s, i) => s + i.price, 0)}</span></div>
          </li>
        )}
        {messages.map((m, i) => (
          <li key={i} className={m.role}>
            {m.text}
            {m.images?.length ? <div className="thumbs">{m.images.map((src) => <img key={src} src={src} alt="" />)}</div> : null}
          </li>
        ))}

        {data && attaching && (
          <li className="choices">
            <div className="photo-grid">
              {data.images.map((i) => (
                <button key={i.id} className={photos.includes(i.id) ? 'picked' : ''} aria-pressed={photos.includes(i.id)} onClick={() => toggle(i.id)}>
                  <img src={i.thumb} alt={`Photo ${i.id}`} />
                </button>
              ))}
            </div>
          </li>
        )}

        {loading && <Progress chatId={chatId} />}
      </ul>
      <form onSubmit={send}>
        <button type="button" onClick={() => setAttaching((a) => !a)} aria-pressed={attaching} title="Attach photos">
          📎{photos.length ? ` ${photos.length}` : ''}
        </button>
        <button
          type="button"
          className={`mic ${mic}`}
          onClick={toggleMic}
          disabled={mic === 'transcribing'}
          aria-pressed={mic === 'recording'}
          aria-label={mic === 'recording' ? 'Stop recording' : 'Speak your message'}
          title={mic === 'recording' ? 'Stop recording' : 'Speak (any Indian language)'}
        >
          {mic === 'recording' ? <PauseIcon /> : mic === 'transcribing' ? <span className="spinner" /> : <MicIcon />}
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={mic === 'recording' ? 'Listening…' : 'Describe the problem'} aria-label="Message" />
        <button disabled={loading || (!input.trim() && !photos.length)}>Send</button>
      </form>
    </main>
  )
}
