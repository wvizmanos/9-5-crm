import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { STAGE_IDS, SOURCE_IDS, sampleLeads, sampleFollowUps, waTarget } from './data'
import { api, forceDemo, getConnection, saveConnection, clearConnection, setDemoFlag, ApiError } from './api'

/* Sheets-backed store (migration Phase 1).
 * - The Google Sheet is the only source of truth in live mode.
 * - localStorage is a read cache ("last known snapshot") so a cold open
 *   still renders when the backend is unreachable — visibly marked.
 * - Mutations are optimistic with refetch-on-settle.
 * - Follow-up dates have no Leads-sheet column; like the old app they
 *   live on-device (waaida-followups) until the Reminders phase wires
 *   them to fu_save/fu_list.
 */

const CACHE_KEY = 'waaida-cache-v1'
const FOLLOWUPS_KEY = 'waaida-followups'
const FU_DONE_KEY = 'waaida-fu-done'
const LINK_SEEN_KEY = 'waaida-link-seen'
const LINK_POLL_MS = 60000
const REMOTE_FU_KEY = 'waaida-reminder-ids'
const TPL_EDITS_KEY = 'waaida-tpl-edits'
const TPL_USES_KEY = 'waaida-tpl-uses'
const TPL_TOMB_KEY = 'waaida-tpl-tomb'
const DEFAULT_TEMPLATES = [
  { id: 't1', name: 'First touch', body: 'Hi {name}! Thanks for reaching out about {product}. I can send a quick quote today — would you like that?' },
  { id: 't2', name: 'Promo nudge', body: 'Hi {name}, quick follow-up on your {product} inquiry. Our promo ends Friday — want me to reserve your slot?' },
  { id: 't3', name: 'Price list', body: 'Hi {name}! Here is the price list you asked for. Happy to walk you through it on a call.' },
  { id: 't4', name: 'Warm follow-up', body: 'Hi {name}! Just checking in — did you get a chance to review the quote for {product}?' },
]

// Maps a raw sheet row (reference/Code.gs list_) to the app lead model.
function mapRow(r) {
  return {
    id: Number(r.id) || Number(r._row) || 0,
    name: r.name || 'Unnamed',
    phone: String(r.phone || ''),
    source: SOURCE_IDS.includes(r.source) ? r.source : 'manual',
    product: r.product || 'Other',
    stage: STAGE_IDS.includes(String(r.stage || '').toLowerCase()) ? String(r.stage).toLowerCase() : 'new',
    value: Number(String(r.value || '0').replace(/[^0-9]/g, '')) || 0,
    intent: Number(r.intent) || 50,
    notes: r.notes || '',
    created: r.created || '',
    activity: parseAct(r.activity),
    nextFollowUp: null, // filled from the local follow-ups map below
  }
}

function parseAct(raw) {
  try {
    const a = JSON.parse(raw || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function loadCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY))
    if (parsed && Array.isArray(parsed.leads)) return parsed
  } catch { /* corrupted cache falls through */ }
  return null
}

function loadFollowUps() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLLOWUPS_KEY))
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* ignore */ }
  return {}
}

function loadFuDone() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FU_DONE_KEY))
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }
  return []
}

function loadTplEdits() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TPL_EDITS_KEY))
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* ignore */ }
  return {}
}
function loadTplUses() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TPL_USES_KEY))
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* ignore */ }
  return {}
}
function loadTplTomb() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TPL_TOMB_KEY))
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }
  return []
}

function loadReminderIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REMOTE_FU_KEY))
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* ignore */ }
  return {}
}

// Last-seen open counts per link id, so new client opens can raise a badge.
function loadLinkSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LINK_SEEN_KEY))
    if (parsed && typeof parsed === 'object') return parsed
  } catch { /* ignore */ }
  return {}
}

function parseOpens(raw) {
  try {
    const a = JSON.parse(raw || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [demoMode, setDemoMode] = useState(forceDemo) // top priority — zero backend traffic when true
  const [connState, setConnState] = useState('demo') // 'demo' | 'live' | 'offline'
  const [busy, setBusy] = useState(false) // any in-flight load/mutation
  const [leads, setLeads] = useState(() => (forceDemo() ? sampleLeads() : (loadCache()?.leads || sampleLeads())))
  const [meta, setMeta] = useState(null) // {sheetName, count, sheetUrl} from the backend
  const [toasts, setToasts] = useState([])
  const [followUps, setFollowUps] = useState(loadFollowUps)
  const [fuDone, setFuDone] = useState(loadFuDone)
  const [demoEdits, setDemoEdits] = useState(null) // demo-mode only: mutated sample leads
  const [links, setLinks] = useState([]) // tracked links (live mode only)
  const [linkBadges, setLinkBadges] = useState({}) // { leadId: opens-since-last-seen }
  const linkSeenRef = useRef(loadLinkSeen())
  const reminderIdsRef = useRef(loadReminderIds())
  const [tplEdits, setTplEdits] = useState(loadTplEdits)
  const [tplUses, setTplUses] = useState(loadTplUses)
  const tplEditsRef = useRef(tplEdits)
  tplEditsRef.current = tplEdits
  const tplUsesRef = useRef(tplUses)
  tplUsesRef.current = tplUses
  const tplTombRef = useRef(loadTplTomb())
  const linksRef = useRef([])
  const docLeadsRef = useRef(leads)
  docLeadsRef.current = leads

  const hasSavedUrl = () => !!getConnection().url
  const demoRef = useRef(demoMode)
  demoRef.current = demoMode
  const authFailedRef = useRef(false) // wrong token → stay usable in demo mode
  const mountedRef = useRef(false)

  function pushToast(msg, kind = 'info') {
    const t = { id: Date.now() + Math.random(), msg, kind }
    setToasts((ts) => [...ts, t])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 5000)
  }

  // ---------- follow-ups (local until the Reminders phase) ----------
  useEffect(() => {
    localStorage.setItem(FOLLOWUPS_KEY, JSON.stringify(followUps))
  }, [followUps])
  useEffect(() => {
    localStorage.setItem(FU_DONE_KEY, JSON.stringify(fuDone))
  }, [fuDone])

  // Persist the last-known snapshot for offline cold starts.
  useEffect(() => {
    if (demoMode) return
    localStorage.setItem(CACHE_KEY, JSON.stringify({ leads, cachedAt: new Date().toISOString() }))
  }, [leads, demoMode])

  // ---------- loading ----------
  async function loadLive() {
    setBusy(true)
    try {
      const rows = await api.list()
      if (!Array.isArray(rows)) throw new ApiError('server', 'Unexpected response from the backend')
      const mapped = rows.map(mapRow)
      authFailedRef.current = false
      setLeads(mapped)
      setConnState('live')
      // pull meta quietly for the Settings screen (never blocks the list)
      api.meta().then(setMeta).catch(() => {})
      await syncReminders()
      await syncTemplates()
      loadLinks(true)
      return true
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthorized') {
        authFailedRef.current = true
        setDemoEdits(null); demoBaseRef.current = null
        pushToast(err.message, 'error')
      } else {
        const cached = loadCache()
        if (cached && cached.leads.length) {
          setLeads(cached.leads)
          pushToast("Can't reach the sheet — showing cached data", 'error')
        } else {
          setDemoEdits(null); demoBaseRef.current = null
          pushToast(err.message || 'Connection failed', 'error')
        }
      }
      setConnState('offline')
      return false
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    if (!demoMode && hasSavedUrl()) loadLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After a successful mutation, quietly adopt the server's truth
  // (backend-minted ids, activity log entries, sheet ordering).
  function refetchOnSettle() {
    if (demoRef.current || authFailedRef.current || !hasSavedUrl()) return
    api.list()
      .then((rows) => {
        if (Array.isArray(rows)) {
          setLeads(rows.map(mapRow))
          setConnState('live')
        }
      })
      .catch(() => setConnState('offline'))
  }

  function run(op) {
    // Wraps a backend call with busy flag + error surface.
    setBusy(true)
    return op
      .then((res) => {
        setBusy(false)
        return res
      })
      .catch((err) => {
        setBusy(false)
        if (err instanceof ApiError && err.code === 'unauthorized') {
          authFailedRef.current = true
          setConnState('offline')
          pushToast(err.message, 'error')
        } else {
          setConnState('offline')
          pushToast(err.message || 'Save failed — kept locally, will retry next change', 'error')
        }
        throw err
      })
  }

  // ---------- follow-up reminders (Phase 3: fu_* on the brain) ----------
  // One live reminder row per lead. Server rows win for scheduling state;
  // local-only entries are migrated (fu_save) on first live load.
  async function syncReminders() {
    if (demoRef.current || authFailedRef.current || !hasSavedUrl()) return
    try {
      const rows = await api.fuList()
      const ids = { ...reminderIdsRef.current }
      let dates = {}
      try { dates = JSON.parse(localStorage.getItem(FOLLOWUPS_KEY) || '{}') || {} } catch { dates = {} }
      let dirty = false
      ;(Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r || !r.leadId) return
        const when = Number(r.when) || 0
        const d = new Date(when)
        const p2 = (x) => String(x).padStart(2, '0')
        const dateStr = when ? d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) : ''
        ids[String(r.leadId)] = r.id
        if (dateStr && !r.done) { dates[String(r.leadId)] = dateStr; dirty = true }
      })
      // migrate local-only entries: no server row yet -> create one
      Object.keys(dates).forEach((leadId) => {
        if (ids[String(leadId)]) return
        const l = (docLeadsRef.current || []).find((x) => String(x.id) === String(leadId))
        if (!l) return
        const when = new Date(dates[leadId] + 'T09:00:00').getTime()
        if (!when) return
        const fid = 'F' + Date.now() + Math.floor(Math.random() * 999)
        ids[String(leadId)] = fid
        api.fuSave({ id: fid, leadId: String(leadId), name: l.name, phone: l.phone || '', what: 'Follow-up', when }).catch(() => {})
        dirty = true
      })
      reminderIdsRef.current = ids
      localStorage.setItem(REMOTE_FU_KEY, JSON.stringify(ids))
      if (dirty) { setFollowUps(dates); localStorage.setItem(FOLLOWUPS_KEY, JSON.stringify(dates)) }
    } catch { /* reminders are auxiliary - never block the app */ }
  }

  // Templates: pull user edits + usage counts from the brain; local wins
  // only when newer. Tombstoned ids (reset on this device) stay reset.
  async function syncTemplates() {
    if (demoRef.current || authFailedRef.current || !hasSavedUrl()) return
    try {
      const rows = await api.tplList()
      let editsChanged = false, usesChanged = false
      ;(Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r || !r.id) return
        if (!tplTombRef.current.includes(String(r.id))) {
          const cur = tplEditsRef.current[r.id]
          const ru = Number(new Date(r.updated).getTime()) || 0
          if ((!cur || ru > (Number(cur.at) || 0)) && r.name && r.body) {
            tplEditsRef.current = { ...tplEditsRef.current, [String(r.id)]: { name: r.name, body: r.body, at: ru || Date.now(), synced: '1' } }
            editsChanged = true
          }
        }
        const uses = Number(r.uses) || 0
        if (uses > (tplUsesRef.current[r.id] || 0)) {
          tplUsesRef.current = { ...tplUsesRef.current, [String(r.id)]: uses }
          usesChanged = true
        }
      })
      if (editsChanged) { setTplEdits(tplEditsRef.current); localStorage.setItem(TPL_EDITS_KEY, JSON.stringify(tplEditsRef.current)) }
      if (usesChanged) { setTplUses(tplUsesRef.current); localStorage.setItem(TPL_USES_KEY, JSON.stringify(tplUsesRef.current)) }
    } catch { /* templates are auxiliary */ }
  }

  // ---------- tracked links (live mode; demo shows a connect hint) ----------
  function absorbLinks(rows, notify) {
    const parsed = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r.id,
      leadId: String(r.leadId || ''),
      url: r.url || '',
      channel: r.channel || 'whatsapp',
      created: r.created || '',
      opens: parseOpens(r.opens),
    }))
    linksRef.current = parsed
    setLinks(parsed)
    // Raise a badge when a lead's links gained opens since we last looked.
    // Links this browser has never seen get a silent baseline — otherwise
    // every historical open would light up on first connect.
    if (notify) {
      const seen = { ...linkSeenRef.current }
      const counts = {}
      parsed.forEach((ln) => {
        const known = Object.prototype.hasOwnProperty.call(seen, ln.id)
        const prev = Number(seen[ln.id]) || 0
        if (!known) {
          seen[ln.id] = ln.opens.length
        } else if (ln.opens.length > prev && ln.leadId) {
          counts[ln.leadId] = (counts[ln.leadId] || 0) + (ln.opens.length - prev)
          seen[ln.id] = ln.opens.length
        }
      })
      linkSeenRef.current = seen
      localStorage.setItem(LINK_SEEN_KEY, JSON.stringify(seen))
      if (Object.keys(counts).length) {
        setLinkBadges((b) => {
          const next = { ...b }
          Object.entries(counts).forEach(([leadId, n]) => { next[leadId] = (next[leadId] || 0) + n })
          return next
        })
        const named = Object.keys(counts)
          .map((leadId) => docLeadsRef.current?.find((l) => String(l.id) === leadId)?.name)
          .filter(Boolean)[0]
        pushToast(named ? `📡 ${named} opened your link` : '📡 A tracked link was opened', 'info')
      }
    }
  }

  async function loadLinks(notify = false) {
    if (demoRef.current || authFailedRef.current || !hasSavedUrl()) return
    try {
      absorbLinks(await api.links(), notify)
    } catch { /* links are auxiliary — never block the app */ }
  }

  useEffect(() => {
    if (connState !== 'live' || demoMode) return undefined
    const iv = setInterval(() => loadLinks(true), LINK_POLL_MS)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connState, demoMode])

  function clearLinkBadge(leadId) {
    setLinkBadges((b) => {
      const next = { ...b }
      delete next[String(leadId)]
      return next
    })
  }

  const nowISO = () => new Date().toISOString()

  // Demo mode (and wrong-token fallback) mutates a private copy of the
  // sample data — never the live leads, never the backend.
  const demoBaseRef = useRef(null)
  const leadsRef = useRef(leads)
  leadsRef.current = leads

  function updateLeads(fn) {
    if (demoRef.current || authFailedRef.current) {
      if (!demoBaseRef.current) {
        demoBaseRef.current = leadsRef.current?.length ? leadsRef.current : sampleLeads()
        // first demo mutation adopts the canned sample follow-ups so the
        // queue keeps working on the mutated sample set
        if (demoRef.current && !authFailedRef.current) {
          setFollowUps((f) => ({ ...sampleFollowUps(), ...f }))
        }
      }
      demoBaseRef.current = fn(demoBaseRef.current)
      setDemoEdits(demoBaseRef.current)
    } else {
      setLeads(fn)
    }
  }

  const actions = {
    // ---- add: adopt the backend-minted integer id (never mint positives locally) ----
    addLead(data) {
      // Sheet-safe phone: production stores digits only (a leading "+" makes
      // Sheets parse the cell as a formula → #ERROR!). Keep wa.me working.
      const phone = String(data.phone || '').replace(/[\s-]/g, '').replace(/^\+/, '')
      const localNextFollowUp = data.nextFollowUp || null
      if (demoMode || authFailedRef.current) {
        const lead = {
          id: -Date.now(), // negative temp id: can never collide with sheet ids
          name: data.name,
          phone,
          source: data.source || 'manual',
          product: data.product || 'Other',
          stage: data.stage || 'new',
          value: Number(data.value) || 0,
          intent: 50,
          notes: data.notes || '',
          created: nowISO(),
          activity: [{ t: 'created', ts: nowISO(), label: 'Lead captured' }],
        }
        updateLeads((ls) => [lead, ...ls])
        if (localNextFollowUp) setFollowUps((f) => ({ ...f, [String(lead.id)]: localNextFollowUp }))
        pushToast('Lead added (demo data only)', 'success')
        return
      }
      const tempId = -Date.now()
      const optimistic = { ...data, phone, id: tempId, created: nowISO(), intent: 50, activity: [{ t: 'created', ts: nowISO(), label: 'Lead captured' }] }
      setLeads((ls) => [optimistic, ...ls])
      run(api.add({ ...data, phone, value: Number(data.value) || 0 }))
        .then(async (res) => {
          const realId = Number(res && res.id) || 0
          if (realId) {
            setLeads((ls) => ls.map((l) => (l.id === tempId ? { ...l, id: realId } : l)))
            if (localNextFollowUp) {
              setFollowUps((f) => {
                const next = { ...f }
                delete next[String(tempId)]
                next[String(realId)] = localNextFollowUp
                return next
              })
            }
          }
          refetchOnSettle()
          pushToast('Lead saved to the sheet', 'success')
        })
        .catch(() => {})
    },

    // ---- stage (kanban drag, modal stage select) ----
    moveLead(id, stage) {
      updateLeads((ls) =>
        ls.map((l) =>
          l.id === id
            ? { ...l, stage, activity: [...(l.activity || []), { t: 'stage', ts: nowISO(), label: 'Moved to ' + stage }] }
            : l
        )
      )
      if (demoMode || authFailedRef.current) return
      run(api.stage(id, stage))
        .then(() => refetchOnSettle())
        .catch(() => {})
    },

    // ---- deal value ----
    setValue(id, value) {
      updateLeads((ls) =>
        ls.map((l) =>
          l.id === id
            ? { ...l, value: Number(value) || 0, activity: [...(l.activity || []), { t: 'stage', ts: nowISO(), label: 'Deal value set to ₱' + (Number(value) || 0) }] }
            : l
        )
      )
      if (demoMode || authFailedRef.current) return
      run(api.value(id, Number(value) || 0))
        .then(() => refetchOnSettle())
        .catch(() => {})
    },

    // ---- notes: the sheet stores one notes string (column 9) ----
    saveNotes(id, text) {
      updateLeads((ls) =>
        ls.map((l) =>
          l.id === id
            ? { ...l, notes: text, activity: [...(l.activity || []), { t: 'note', ts: nowISO(), label: 'Note added' }] }
            : l
        )
      )
      if (demoMode || authFailedRef.current) return
      run(api.note(id, text))
        .then(() => refetchOnSettle())
        .catch(() => {})
    },

    // ---- follow-ups: local-only until the Reminders phase ----
    setFollowUp(id, date) {
      setFollowUps((f) => {
        const next = { ...f }
        if (date) next[String(id)] = date
        else delete next[String(id)]
        return next
      })
      if (demoMode || authFailedRef.current || !hasSavedUrl()) return
      const l = (leadsRef.current || []).find((x) => String(x.id) === String(id))
      const when = date ? new Date(date + 'T09:00:00').getTime() : 0
      let fid = reminderIdsRef.current[String(id)]
      if (!date) {
        if (fid) { api.fuDel({ id: fid }).catch(() => {}) }
        delete reminderIdsRef.current[String(id)]
        localStorage.setItem(REMOTE_FU_KEY, JSON.stringify(reminderIdsRef.current))
        return
      }
      if (!fid) {
        fid = 'F' + Date.now() + Math.floor(Math.random() * 999)
        reminderIdsRef.current[String(id)] = fid
        localStorage.setItem(REMOTE_FU_KEY, JSON.stringify(reminderIdsRef.current))
      }
      api.fuSave({ id: fid, leadId: String(id), name: l ? l.name : '', phone: l ? l.phone || '' : '', what: 'Follow-up', when }).catch(() => {})
    },
    markFollowUpDone(id) {
      const dt = new Date()
      dt.setDate(dt.getDate() + 3)
      const p = (x) => String(x).padStart(2, '0')
      const next = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
      this.setFollowUp(id, next)
      setFuDone((d) => [...d, { leadId: String(id), at: nowISO() }])
      pushToast('Follow-up done — next one in 3 days', 'success')
    },

    deleteLead(id) {
      updateLeads((ls) => ls.filter((l) => l.id !== id))
      setFollowUps((f) => {
        const next = { ...f }
        delete next[String(id)]
        return next
      })
      if (demoMode || authFailedRef.current) {
        pushToast('Lead deleted (demo data only)', 'success')
        return
      }
      run(api.delete(id))
        .then(() => {
          refetchOnSettle()
          pushToast('Lead deleted — links, proposals and reminders cascaded', 'success')
        })
        .catch(() => {})
    },

    async connect(url, token) {
      if (!url || !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
        throw new ApiError('server', 'Paste the Apps Script Web App URL (ends in /exec)')
      }
      saveConnection(url, token)
      authFailedRef.current = false
      setDemoMode(false)
      setDemoEdits(null); demoBaseRef.current = null
      const ok = await loadLive()
      if (ok) pushToast('Connected — loaded from your sheet', 'success')
    },

    disconnect() {
      clearConnection()
      authFailedRef.current = false
      setDemoEdits(null); demoBaseRef.current = null
      setDemoMode(true)
      setConnState('demo')
      setMeta(null)
      setLinks([])
      setLinkBadges({})
      pushToast('Disconnected — showing demo data', 'info')
    },

    useDemoData(on) {
      setDemoFlag(on)
      if (on) {
        authFailedRef.current = false
        setDemoEdits(null); demoBaseRef.current = null
        setDemoMode(true)
        setConnState('demo')
        setMeta(null)
        setLinks([])
        setLinkBadges({})
      } else {
        setDemoMode(false)
        if (hasSavedUrl()) loadLive()
        else {
          setConnState('demo')
          pushToast('Paste your Apps Script URL to connect', 'info')
        }
      }
    },

    reload() {
      if (!demoMode && hasSavedUrl()) loadLive()
    },

    // ---- tracked links (Phase 2; live mode only, like the old app) ----
    async createLink(lead, url, channel) {
      const res = await run(api.createLink(lead.id, url, channel))
      if (res && res.id) {
        // activity parity with the old app: log "Link sent via <channel>"
        api.actLog(lead.id, 'Link sent via ' + channel).catch(() => {})
        refetchOnSettle()
        await loadLinks(false)
      }
      return res
    },
    async deleteLink(linkId) {
      await run(api.deleteLink(linkId))
      await loadLinks(false)
    },
    // Opening a lead's drawer acknowledges its open-pings.
    markLinkSeen(leadId) {
      const seen = { ...linkSeenRef.current }
      linksRef.current
        .filter((ln) => String(ln.leadId) === String(leadId))
        .forEach((ln) => { seen[ln.id] = ln.opens.length })
      linkSeenRef.current = seen
      localStorage.setItem(LINK_SEEN_KEY, JSON.stringify(seen))
      clearLinkBadge(leadId)
    },

    saveTemplate(id, name, body) {
      if (!name || !body) { pushToast('Give it a name and a message', 'error'); return }
      tplEditsRef.current = { ...tplEditsRef.current, [id]: { name, body, at: Date.now(), synced: '1' } }
      setTplEdits(tplEditsRef.current)
      localStorage.setItem(TPL_EDITS_KEY, JSON.stringify(tplEditsRef.current))
      if (demoMode || authFailedRef.current) { pushToast('Template saved (demo data only)', 'success'); return }
      api.tplSave({ id, name, body }).catch(() => {
        const e = tplEditsRef.current[id]
        if (e) {
          tplEditsRef.current = { ...tplEditsRef.current, [id]: { ...e, synced: '' } }
          localStorage.setItem(TPL_EDITS_KEY, JSON.stringify(tplEditsRef.current))
        }
      })
      pushToast('Template saved', 'success')
    },
    resetTemplate(id) {
      const next = { ...tplEditsRef.current }
      delete next[id]
      tplEditsRef.current = next
      setTplEdits(next)
      localStorage.setItem(TPL_EDITS_KEY, JSON.stringify(next))
      if (!tplTombRef.current.includes(String(id))) {
        tplTombRef.current = [...tplTombRef.current, String(id)]
        localStorage.setItem(TPL_TOMB_KEY, JSON.stringify(tplTombRef.current))
      }
      if (demoMode || authFailedRef.current) { pushToast('Template reset to default', 'success'); return }
      api.tplDel({ id }).catch(() => {})
      pushToast('Template reset to default', 'success')
    },
    bumpTplUse(id) {
      tplUsesRef.current = { ...tplUsesRef.current, [id]: (tplUsesRef.current[id] || 0) + 1 }
      setTplUses(tplUsesRef.current)
      localStorage.setItem(TPL_USES_KEY, JSON.stringify(tplUsesRef.current))
      if (demoMode || authFailedRef.current) return
      const base = (tplUsesRef.current || {})[id] || 0
      api.tplUse({ id, base }).then((res) => {
        if (res && res.uses != null && res.uses !== tplUsesRef.current[id]) {
          tplUsesRef.current = { ...tplUsesRef.current, [id]: res.uses }
          setTplUses(tplUsesRef.current)
          localStorage.setItem(TPL_USES_KEY, JSON.stringify(tplUsesRef.current))
        }
      }).catch(() => {})
    },

    async sendWhatsApp(lead, tpl) {
      if (!lead || !tpl) return { ok: false, error: 'nothing to send' }
      if (demoMode || authFailedRef.current) return { ok: false, error: 'demo mode - connect the sheet to auto-send' }
      const digits = waTarget(lead.phone)
      if (!digits) { pushToast('This lead has no phone number yet', 'error'); return { ok: false, error: 'phone missing' } }
      const msg = String(tpl.body || '')
        .replace(/\{name\}/g, String(lead.name || '').split(' ')[0] || 'there')
        .replace(/\{product\}/g, lead.product || 'it')
      pushToast('Sending via WhatsApp...', 'info')
      try {
        const r = await api.waSend(digits, msg)
        if (r && r.ok) {
          this.bumpTplUse(tpl.id)
          api.actLog(String(lead.id), 'WhatsApp sent: ' + (tpl.name || 'quick message')).catch(() => {})
          setLeads((ls) => ls.map((l) => (String(l.id) === String(lead.id) ? { ...l, activity: [...(l.activity || []), { t: 'wa', ts: new Date().toISOString(), label: 'WhatsApp sent: ' + (tpl.name || 'quick message') }] } : l)))
          pushToast('Sent to ' + String(lead.name || '').split(' ')[0], 'success')
        } else {
          pushToast('WhatsApp: ' + ((r && r.error) || 'send failed'), 'error')
        }
        return r
      } catch (e) {
        pushToast('WhatsApp: ' + ((e && e.message) || 'send failed'), 'error')
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    async importLeads(rows) {
      if (!Array.isArray(rows) || !rows.length) return { ok: false, added: 0 }
      if (demoMode || authFailedRef.current || !hasSavedUrl()) {
        pushToast('Connect the sheet first - import writes to the live brain', 'error')
        return { ok: false, added: 0 }
      }
      const stamped = rows.map((r, i) => ({ ...r, tempId: -(Date.now() + i) }))
      setLeads((ls) => [...stamped, ...ls])
      pushToast('Importing ' + stamped.length + ' leads...', 'info')
      try {
        const res = await api.importRows(stamped.map((r) => ({ ...r, tempId: String(r.tempId) })))
        if (res && res.ok && Array.isArray(res.ids)) {
          const byTemp = {}
          res.ids.forEach((x) => { byTemp[String(x.temp)] = Number(x.id) || 0 })
          setLeads((ls) => ls.map((l) => (byTemp[String(l.id)] ? { ...l, id: byTemp[String(l.id)] } : l)))
          pushToast('Imported ' + res.added + ' leads', 'success')
          return { ok: true, added: res.added }
        }
        if (res && res.error && String(res.error).indexOf('unknown action') >= 0) {
          let added = 0
          for (const r of stamped) {
            try {
              const one = await api.add({ name: r.name, phone: r.phone, source: r.source, product: r.product, stage: r.stage, value: r.value, notes: r.notes })
              const realId = Number(one && one.id) || 0
              if (realId) setLeads((ls) => ls.map((l) => (l.id === r.tempId ? { ...l, id: realId } : l)))
              added++
            } catch (_) {}
          }
          pushToast('Imported ' + added + ' leads (legacy brain)', 'success')
          return { ok: true, added }
        }
        pushToast('Import: ' + ((res && res.error) || 'failed'), 'error')
        return { ok: false, added: 0 }
      } catch (e) {
        pushToast('Import failed: ' + ((e && e.message) || 'unknown'), 'error')
        return { ok: false, added: 0 }
      }
    },
    // Email (multichannel). The backend action writes the activity row
    // itself ("Email sent: <subject>"); the append below is optimistic and
    // refetchOnSettle reconciles it with the sheet's truth.
    async sendEmail(lead, { to, subject, htmlBody }) {
      if (!lead || !subject) return { ok: false, error: 'nothing to send' }
      if (demoMode || authFailedRef.current) return { ok: false, error: 'demo mode - connect the sheet to send email' }
      const addr = String(to || '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
        pushToast('Enter a valid recipient email', 'error')
        return { ok: false, error: 'bad email' }
      }
      pushToast('Sending email...', 'info')
      try {
        const r = await api.sendEmail(addr, subject, htmlBody, String(lead.id))
        if (r && r.ok) {
          const label = 'Email sent: ' + subject
          setLeads((ls) => ls.map((l) => (String(l.id) === String(lead.id) ? { ...l, activity: [...(l.activity || []), { t: 'email', ts: new Date().toISOString(), label }] } : l)))
          refetchOnSettle()
          pushToast('Email sent to ' + addr, 'success')
        } else {
          pushToast('Email: ' + ((r && r.error) || 'send failed'), 'error')
        }
        return r
      } catch (e) {
        pushToast('Email: ' + ((e && e.message) || 'send failed'), 'error')
        return { ok: false, error: String((e && e.message) || e) }
      }
    },

    // Records that a channel was opened for this lead. The link-first flow
    // cannot confirm a send, so the label says "opened" - a touch trail, not
    // delivery proof. Local append always; sheet write only when live.
    logActivity(lead, label) {
      if (!lead || !label) return
      const entry = { t: 'wa', ts: new Date().toISOString(), label: label }
      setLeads((ls) => ls.map((l) => (String(l.id) === String(lead.id) ? { ...l, activity: [...(l.activity || []), entry] } : l)))
      if (demoMode || authFailedRef.current) return
      api.actLog(String(lead.id), label).catch(() => {})
    },

    linksFor(leadId) {
      return linksRef.current.filter((ln) => String(ln.leadId) === String(leadId))
    },
  }

  // Leads served to the UI: demo edits override the sample set; live
  // leads get their local follow-up dates attached.
  const uiLeads = useMemo(() => {
    if (demoMode || authFailedRef.current) {
      const base = demoEdits || leads
      const fu = demoMode && !demoEdits ? sampleFollowUps() : followUps
      return base.map((l) => ({ ...l, nextFollowUp: fu[String(l.id)] || null }))
    }
    return leads.map((l) => ({ ...l, nextFollowUp: followUps[String(l.id)] || null }))
  }, [leads, demoMode, demoEdits, followUps])

  const sync = {
    // pill state: 'demo' | 'live' | 'offline' (+ busy → 'Saving…')
    status: busy ? 'saving' : demoMode || authFailedRef.current ? 'demo' : connState,
    connState: demoMode || authFailedRef.current ? 'demo' : connState,
    busy,
    demoMode: demoMode || authFailedRef.current,
    meta,
    toasts,
    followUpsCompletedThisWeek: fuDone.filter((d) => {
      const t = new Date(d.at).getTime()
      const now = new Date()
      const monday = new Date(now)
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      monday.setHours(0, 0, 0, 0)
      return t >= monday.getTime()
    }).length,
  }

  function tplAll() {
    return DEFAULT_TEMPLATES.map((t) => {
      if (tplTombRef.current.includes(t.id)) return t
      const e = tplEditsRef.current[t.id]
      return e ? { ...t, name: e.name, body: e.body, edited: 1 } : t
    })
  }

  return <StoreContext.Provider value={{ leads: uiLeads, actions, sync, pushToast, links, linkBadges, templates: tplAll(), tplUses }}>{children}</StoreContext.Provider>
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

export function formatPeso(n) {
  return '₱' + Number(n).toLocaleString('en-PH')
}

export function relTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return String(iso)
  const diff = Math.max(0, Date.now() - t)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  const d = Math.floor(h / 24)
  if (d < 7) return d + 'd'
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}
