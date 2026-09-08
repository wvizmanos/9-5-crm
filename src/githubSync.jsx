import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { seedLeads } from './data'

/* ═══════════════════════════════════════════════════════════════════
 * LEGACY DATA LAYER — GitHub JSON repo sync (wa-aida-crm-data)
 *
 * DISABLED BY FEATURE FLAG (migration brief hard rule 2): the Google
 * Sheet backend is now the only source of truth. This module is kept
 * for reference / rollback but must never run while the flag is false.
 * Nothing imports it. Do not re-enable without removing the Sheets
 * data layer first — one brain.
 * ═══════════════════════════════════════════════════════════════════ */

export const GITHUB_SYNC_ENABLED = false

const DOC_KEY = 'wa-aida-leads-v1'
const TOKEN_KEY = 'wa-aida-token'
const DATA_REPO = 'wa-aida-crm-data'
const DATA_PATH = 'data/leads.json'
const COMMIT_MESSAGE = 'CRM update from web'
const DEBOUNCE_MS = 2000

// ---------- base64 that survives UTF-8 (₱, emoji) ----------
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function ghFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  })
}

function fileUrl(owner) {
  return `https://api.github.com/repos/${owner}/${DATA_REPO}/contents/${DATA_PATH}`
}

// ---------- local document (localStorage = offline fallback) ----------
function loadDoc() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DOC_KEY))
    if (Array.isArray(parsed)) return { updatedAt: null, leads: parsed } // pre-sync format
    if (parsed && Array.isArray(parsed.leads)) return parsed
  } catch { /* corrupted storage falls through to seed */ }
  return { updatedAt: null, leads: seedLeads() }
}

const StoreContext = createContext(null)

export function GitHubSyncProvider({ children }) {
  const [doc, setDoc] = useState(loadDoc)
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [syncStatus, setSyncStatus] = useState(() => (localStorage.getItem(TOKEN_KEY) ? 'offline' : 'disconnected'))
  const [lastSyncAt, setLastSyncAt] = useState(null)

  const docRef = useRef(doc)
  docRef.current = doc
  const tokenRef = useRef(token)
  tokenRef.current = token
  const ownerRef = useRef(null)
  const shaRef = useRef(null)
  const timerRef = useRef(null)
  const skipFirstSaveRef = useRef(true)
  const skipNextPushRef = useRef(false)

  const leads = doc.leads

  function schedulePush(delay = DEBOUNCE_MS) {
    if (!tokenRef.current) return
    clearTimeout(timerRef.current)
    setSyncStatus('saving')
    timerRef.current = setTimeout(() => push(), delay)
  }

  async function push() {
    const tok = tokenRef.current
    if (!tok || !ownerRef.current) return
    const current = docRef.current
    try {
      const body = { message: COMMIT_MESSAGE, content: utf8ToB64(JSON.stringify(current, null, 2)) }
      if (shaRef.current) body.sha = shaRef.current
      const res = await ghFetch(fileUrl(ownerRef.current), tok, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        shaRef.current = (await res.json()).content.sha
        setSyncStatus('synced')
        setLastSyncAt(new Date().toISOString())
        return
      }
      if (res.status === 409 || res.status === 422) {
        // Remote moved since our last known SHA — reconcile before retrying.
        const file = await ghFetch(fileUrl(ownerRef.current), tok)
        if (!file.ok) throw new Error(`fetch for conflict resolution failed: ${file.status}`)
        const fileJson = await file.json()
        const remoteDoc = JSON.parse(b64ToUtf8(fileJson.content))
        shaRef.current = fileJson.sha
        const remoteNewer = remoteDoc.updatedAt && current.updatedAt && remoteDoc.updatedAt > current.updatedAt
        if (remoteNewer) {
          skipNextPushRef.current = true
          setDoc(remoteDoc)
          setSyncStatus('synced')
          setLastSyncAt(new Date().toISOString())
          return
        }
        return push() // our change is newer — retry with fresh SHA
      }
      throw new Error(`PUT failed: ${res.status}`)
    } catch {
      setSyncStatus('offline')
    }
  }

  async function fetchRemote() {
    const tok = tokenRef.current
    if (!tok) return
    try {
      if (!ownerRef.current) {
        const me = await ghFetch('https://api.github.com/user', tok)
        if (!me.ok) throw new Error(`token check failed: ${me.status}`)
        ownerRef.current = (await me.json()).login
      }
      const res = await ghFetch(fileUrl(ownerRef.current), tok)
      if (res.status === 404) {
        // No remote file yet — upload what we have so both sides start from the same data.
        shaRef.current = null
        setSyncStatus('synced')
        setLastSyncAt(new Date().toISOString())
        schedulePush(500)
        return
      }
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      const file = await res.json()
      shaRef.current = file.sha
      const remoteDoc = JSON.parse(b64ToUtf8(file.content))
      const local = docRef.current
      const remoteNewer = remoteDoc.updatedAt && (!local.updatedAt || remoteDoc.updatedAt > local.updatedAt)
      if (remoteNewer) {
        skipNextPushRef.current = true
        setDoc(remoteDoc)
      } else if (local.updatedAt && (!remoteDoc.updatedAt || local.updatedAt > remoteDoc.updatedAt)) {
        schedulePush(500) // local has newer edits than the remote file
      }
      setSyncStatus('synced')
      setLastSyncAt(new Date().toISOString())
    } catch {
      setSyncStatus('offline')
    }
  }

  // Re-fetch whenever a token is set (connect or saved token on load).
  useEffect(() => {
    if (token) fetchRemote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Persist locally on every change; schedule a push when online.
  useEffect(() => {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc))
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }
    schedulePush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  const actions = {
    addLead(data) {
      const lead = {
        id: `lead-${Date.now()}`,
        notes: [],
        activity: [{ at: localISO(new Date()), text: 'Lead created' }],
        ...data,
      }
      setDoc((d) => ({ updatedAt: new Date().toISOString(), leads: [lead, ...d.leads] }))
      return lead
    },
    updateLead(id, patch, activityText) {
      setDoc((d) => ({
        updatedAt: new Date().toISOString(),
        leads: d.leads.map((l) => {
          if (l.id !== id) return l
          const next = { ...l, ...patch }
          if (activityText) {
            next.activity = [...(l.activity || []), { at: localISO(new Date()), text: activityText }]
          }
          return next
        }),
      }))
    },
    deleteLead(id) {
      setDoc((d) => ({ updatedAt: new Date().toISOString(), leads: d.leads.filter((l) => l.id !== id) }))
    },
    moveLead(id, stage) {
      this.updateLead(id, { stage }, `Moved to ${stage.charAt(0).toUpperCase() + stage.slice(1)}`)
    },
    addNote(id, text) {
      setDoc((d) => ({
        updatedAt: new Date().toISOString(),
        leads: d.leads.map((l) =>
          l.id === id
            ? {
                ...l,
                notes: [...(l.notes || []), { at: localISO(new Date()), text }],
                activity: [...(l.activity || []), { at: localISO(new Date()), text: 'Note added' }],
              }
            : l
        ),
      }))
    },
    markFollowUpDone(id) {
      const dt = new Date()
      dt.setDate(dt.getDate() + 3)
      this.updateLead(id, { nextFollowUp: localISO(dt) }, 'Follow-up completed — next one scheduled in 3 days')
    },
  }

  const sync = {
    status: syncStatus,
    lastSyncAt,
    connected: !!token,
    async connect(newToken) {
      const me = await ghFetch('https://api.github.com/user', newToken)
      if (me.status === 401) throw new Error('Token was rejected. Check that you copied the full github_pat_… value.')
      if (!me.ok) throw new Error(`GitHub returned ${me.status}. Try again.`)
      const login = (await me.json()).login
      const repo = await ghFetch(`https://api.github.com/repos/${login}/${DATA_REPO}`, newToken)
      if (!repo.ok) {
        throw new Error(`Cannot access ${DATA_REPO} with this token. Check that the repo exists and the token selects it with Contents: Read and write.`)
      }
      ownerRef.current = login
      localStorage.setItem(TOKEN_KEY, newToken)
      setToken(newToken)
      return login
    },
    disconnect() {
      localStorage.removeItem(TOKEN_KEY)
      clearTimeout(timerRef.current)
      shaRef.current = null
      ownerRef.current = null
      setToken('')
      setSyncStatus('disconnected')
      setLastSyncAt(null)
    },
    retry() {
      if (tokenRef.current) fetchRemote()
    },
  }

  return <StoreContext.Provider value={{ leads, actions, sync }}>{children}</StoreContext.Provider>
}

export function useStore() {
  return useContext(StoreContext)
}

// All dates are handled as local calendar dates (YYYY-MM-DD) to avoid UTC off-by-one issues.
export function localISO(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function todayISO() {
  return localISO(new Date())
}

export function isOverdue(dateStr) {
  return !!dateStr && dateStr < todayISO()
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const dt = new Date(dateStr + 'T12:00:00')
  return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}
