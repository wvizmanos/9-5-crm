/* WA AIDA CRM — Google Sheets backend client (Apps Script Web App).
 * Contract extracted from reference/Code.gs and reference/v19-app.html:
 * every action is a GET with query params (browsers lose POST bodies to
 * the 302 redirect), response is JSON, optional ?token gate against the
 * script property WA_AIDA_TOKEN.
 *
 * Settings start EMPTY (migration brief hard rule 4) — no baked-in URL
 * or token. The user pastes their /exec URL and optional token.
 */

const URL_KEY = 'waaida-script-url'
const TOKEN_KEY = 'waaida-token'
const DEMO_KEY = 'waaida-force-demo'

export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code // 'unauthorized' | 'network' | 'server'
  }
}

// Same regex + priority as the old app (reference/v19-app.html): the URL
// param beats everything, then the Settings "Use demo data" flag.
export function forceDemo() {
  return /(?:^|[?&])demo=1(?:&|$)/.test(location.search) || localStorage.getItem(DEMO_KEY) === '1'
}

export function getConnection() {
  return {
    url: localStorage.getItem(URL_KEY) || '',
    token: localStorage.getItem(TOKEN_KEY) || '',
  }
}

export function saveConnection(url, token) {
  localStorage.setItem(URL_KEY, url.replace(/\/+$/, ''))
  if (token) localStorage.setItem(TOKEN_KEY, token.trim())
  else localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(DEMO_KEY) // connecting always leaves demo mode (old-app parity)
}

export function clearConnection() {
  localStorage.removeItem(URL_KEY)
}

export function setDemoFlag(on) {
  if (on) {
    localStorage.setItem(DEMO_KEY, '1')
    localStorage.removeItem(URL_KEY) // old-app parity: demo disconnects the sheet
  } else {
    localStorage.removeItem(DEMO_KEY)
  }
}

export function isDemoFlagged() {
  return localStorage.getItem(DEMO_KEY) === '1'
}

async function call(action, params = {}) {
  const { url, token } = getConnection()
  if (!url) throw new ApiError('server', 'No Apps Script URL configured')
  const q = new URLSearchParams({ action, ...(token ? { token } : {}), t: String(Date.now()) })
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) q.set(k, String(v))
  }
  let data
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}${q.toString()}`, { method: 'GET' })
    data = await res.json()
  } catch {
    throw new ApiError('network', "Can't reach the Apps Script Web App — check your connection or the /exec URL.")
  }
  if (data && data.error === 'unauthorized') {
    throw new ApiError('unauthorized', 'Security token missing or wrong — add it in Settings')
  }
  if (data && data.error) {
    throw new ApiError('server', String(data.error))
  }
  return data
}

// One function per backend action used by the app.
export const api = {
  list: () => call('list'),
  meta: () => call('meta'),
  add: (lead) =>
    call('add', {
      name: lead.name,
      phone: lead.phone,
      source: lead.source,
      product: lead.product,
      stage: lead.stage,
      value: lead.value,
      notes: lead.notes,
    }),
  stage: (id, stage) => call('stage', { id, stage }),
  note: (id, notes) => call('note', { id, notes }),
  value: (id, value) => call('value', { id, value }),
  delete: (id) => call('delete', { id }),

  // ── Tracked links (Phase 2) — exact params from reference/Code.gs ──
  createLink: (leadId, url, channel) => call('link', { leadId, url, channel }),
  links: () => call('links'),
  deleteLink: (id) => call('linkdel', { id }),
  actLog: (id, label) => call('actlog', { id, label }),

  // WhatsApp Cloud API send (slice 2): backend waSend_ posts to Meta.
  waSend: (phone, text) => call('wa_send', { phone, text }),
  importRows: (rows) => call('import_rows', { rows: JSON.stringify(rows) }),

  // Follow-up reminders (Phase 3): one live reminder row per lead on the
  // Reminders tab. The daily Apps Script trigger emails the digest.
  fuSave: (r) => call('fu_save', r),
  fuDel: (id) => call('fu_del', { id }),
  fuList: () => call('fu_list'),

  // Message templates (Phase 3): defaults live in code; user edits are
  // upserted to the Templates tab so they survive cache clears.
  tplSave: (r) => call('tpl_save', r),
  tplDel: (id) => call('tpl_del', { id }),
  tplList: () => call('tpl_list'),
  tplUse: (id, base) => call('tpl_use', { id, base }),
}
