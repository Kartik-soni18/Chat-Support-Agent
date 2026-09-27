import { useSyncExternalStore } from 'react'

export const api = (path: string) => (import.meta.env.VITE_API_URL ?? '') + path

export type Kind = 'api' | 'redis' | 'llm' | 'tool' | 'db' | 'jev' | 'queue'
export type Activity = {
  id: string
  kind: Kind
  title: string
  status: 'start' | 'done' | 'error'
  at: number
  startedAt: number
  chatId?: string
  detail?: Record<string, unknown>
  ms?: number
  summary?: string
  result?: any
}

const rows = new Map<string, Activity>()
const listeners = new Set<() => void>()
let snapshot = { rows: [] as Activity[], writes: {} as Record<string, number> }
let connectedBefore = false
let source: EventSource | undefined
let url = '/events'

export function connect(streamUrl: string) {
  url = streamUrl
  open()
}

type Reply = { chatId: string; jobId: string; reply?: string; error?: string }
const early = new Map<string, Reply>()
const waiting = new Map<string, (r: Reply) => void>()

function onReply(e: MessageEvent) {
  const r: Reply = JSON.parse(e.data)
  const resolve = waiting.get(r.jobId)
  if (resolve) { waiting.delete(r.jobId); resolve(r) } else early.set(r.jobId, r)
}

function open() {
  if (source) return
  source = new EventSource(api(url))
  source.onmessage = onMessage
  source.addEventListener('reply', onReply)
  source.addEventListener('ready', () => { connectedBefore = true })
}

export function waitForReply(jobId: string, timeoutMs = 180_000): Promise<string> {
  open()
  return new Promise((resolve, reject) => {
    const done = (r: Reply) => { clearTimeout(timer); if (r.error) reject(new Error(r.error)); else resolve(r.reply ?? '') }
    const timer = setTimeout(() => { waiting.delete(jobId); reject(new Error('No reply yet. Send the message again.')) }, timeoutMs)
    const ready = early.get(jobId)
    if (ready) { early.delete(jobId); done(ready) } else waiting.set(jobId, done)
  })
}

function onMessage(e: MessageEvent) {
  const a: Activity = JSON.parse(e.data)
  const prev = rows.get(a.id)
  rows.set(a.id, { ...prev, ...a, startedAt: prev?.startedAt ?? a.at })
  const changed = a.chatId && a.kind === 'redis' && a.status === 'done' && /^(RPUSH chat:|SET report:)/.test(a.title)
    && prev?.status !== 'done' && connectedBefore
  snapshot = {
    rows: [...rows.values()].sort((x, y) => y.startedAt - x.startedAt).slice(0, 300),
    writes: changed ? { ...snapshot.writes, [a.chatId!]: (snapshot.writes[a.chatId!] ?? 0) + 1 } : snapshot.writes,
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  open()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useActivity = () => useSyncExternalStore(subscribe, () => snapshot)
