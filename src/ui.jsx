import { useEffect, useRef, useState } from 'react'
import { autoMap, IMPORT_TARGETS, parseCsv, rowsToLeads } from './csv'
import { SOURCE_STYLES, SOURCES, STAGES, smsLink, sourceLabel, viberLink, waTarget } from './data'
import { formatDate, formatPeso, isOverdue, todayISO, useStore } from './store'
import { api, getConnection } from './api'

// ---------- small shared bits ----------

export function SourceBadge({ source }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${SOURCE_STYLES[source] || 'bg-stone-100 text-stone-700 border-stone-300'}`}>
      {sourceLabel(source)}
    </span>
  )
}

export function StageBadge({ stage }) {
  const s = STAGES.find((x) => x.id === stage)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s?.color }} />
      {s?.label || stage}
    </span>
  )
}

const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-wagreen/60 disabled:opacity-40 disabled:cursor-not-allowed'

export function Button({ variant = 'primary', className = '', ...props }) {
  const variants = {
    primary: 'bg-wagreen text-white hover:bg-deepgreen active:bg-deepgreen/90 shadow-sm',
    secondary: 'bg-white text-navy border border-stone-300 hover:border-navy/50 hover:bg-stone-50 active:bg-stone-100',
    danger: 'bg-white text-terracotta border border-terracotta/40 hover:bg-terracotta hover:text-white active:bg-terracotta/90',
    ghost: 'text-navy/70 hover:bg-navy/5 hover:text-navy active:bg-navy/10',
  }
  return <button className={`${btnBase} ${variants[variant]} ${className}`} {...props} />
}

export const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-navy placeholder:text-stone-400 focus:border-wagreen focus:outline-none focus:ring-2 focus:ring-wagreen/25 disabled:bg-stone-50 disabled:text-stone-500'

// ---------- Add / Edit lead modal ----------
// The sheet backend has actions for stage / value / notes / delete only —
// name, phone, source and product are fixed after creation (they can be
// corrected in the Google Sheet). In demo mode everything is editable.

export function LeadModal({ lead, onClose }) {
  const { actions, sync } = useStore()
  const editing = !!lead
  const canEditCore = !editing || sync.demoMode // add always; edit core fields only in demo
  const [form, setForm] = useState({
    name: lead?.name || '',
    phone: lead?.phone || '',
    source: lead?.source || 'manual',
    product: lead?.product || '',
    stage: lead?.stage || 'new',
    value: lead?.value ?? '',
    nextFollowUp: lead?.nextFollowUp || '',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!editing) {
      const errs = {}
      if (!form.name.trim()) errs.name = 'Name is required'
      if (!form.phone.trim()) errs.phone = 'Phone number is required'
      else if (!/^\+?[\d\s-]{7,15}$/.test(form.phone.trim())) errs.phone = 'Enter a valid phone number'
      setErrors(errs)
      if (Object.keys(errs).length) return
      setSaving(true)
      try {
        actions.addLead({ ...form, name: form.name.trim(), phone: form.phone.trim(), value: Number(form.value) || 0, nextFollowUp: form.nextFollowUp || null })
        onClose()
      } finally {
        setSaving(false)
      }
      return
    }
    // Edit: the sheet backend only supports stage / value changes here
    // (name, phone, source, product are fixed) — no validation needed.
    setSaving(true)
    try {
      if (form.stage !== lead.stage) actions.moveLead(lead.id, form.stage)
      if ((Number(form.value) || 0) !== lead.value) actions.setValue(lead.id, Number(form.value) || 0)
      actions.setFollowUp(lead.id, form.nextFollowUp || null)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{editing ? 'Edit lead' : 'New lead'}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close" className="h-8 w-8 !p-0 text-xl leading-none">×</Button>
        </div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy/70">Name *</label>
            <input className={inputCls} value={form.name} onChange={set('name')} disabled={!canEditCore} placeholder="e.g. Maria Santos" />
            {errors.name && <p className="mt-1 text-xs text-terracotta">{errors.name}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy/70">Business / product</label>
            <input className={inputCls} value={form.product} onChange={set('product')} disabled={!canEditCore} placeholder="e.g. Siomai Franchise" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy/70">WhatsApp number *</label>
            <input className={inputCls} value={form.phone} onChange={set('phone')} disabled={!canEditCore} placeholder="+63 9xx xxx xxxx" />
            {errors.phone && <p className="mt-1 text-xs text-terracotta">{errors.phone}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-navy/70">Source</label>
              <select className={inputCls} value={form.source} onChange={set('source')} disabled={!canEditCore}>
                {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-navy/70">Deal value (₱)</label>
              <input type="number" min="0" className={inputCls} value={form.value} onChange={set('value')} placeholder="15000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-navy/70">Stage</label>
              <select className={inputCls} value={form.stage} onChange={set('stage')}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-navy/70">Next follow-up</label>
              <input type="date" className={inputCls} value={form.nextFollowUp} onChange={set('nextFollowUp')} />
            </div>
          </div>
          {editing && !sync.demoMode && (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-navy/50">
              Name, number, source and business are fixed once a lead is in the sheet — correct them in the Google Sheet. Stage, value and follow-up save via the backend.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add lead'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------- Lead detail drawer ----------

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'viber', label: 'Viber' },
]

function channelLabel(ch) {
  return ch === 'whatsapp' ? 'WhatsApp' : ch === 'viber' ? 'Viber' : ch === 'email' ? 'Email' : 'SMS'
}

export function TrackedLinks({ lead }) {
  const { links, actions, sync, pushToast } = useStore()
  const [url, setUrl] = useState(() => localStorage.getItem('waaida-proposal-url') || '')
  const [channel, setChannel] = useState('whatsapp')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState(null)

  const leadLinks = links.filter((ln) => String(ln.leadId) === String(lead.id))
  const live = sync.connState === 'live'

  async function send() {
    if (!/^https?:\/\//i.test(url.trim())) {
      pushToast('Enter a valid link starting with https://', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await actions.createLink(lead, url.trim(), channel)
      if (res && res.id) {
        localStorage.setItem('waaida-proposal-url', url.trim())
        const msg = 'Here is your proposal: ' + res.trackUrl
        const digits = waTarget(lead.phone)
        if (channel === 'whatsapp') {
          window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
        } else if (channel === 'viber') {
          try { navigator.clipboard.writeText(msg) } catch { /* clipboard optional */ }
          window.open(`viber://chat?number=%2B${digits}`, '_blank')
          pushToast('Viber opened — message copied, paste it to send', 'success')
        }
        pushToast(`Link sent via ${channelLabel(channel)} — tracking enabled`, 'success')
      }
    } catch {
      /* run() already toasted the reason */
    } finally {
      setBusy(false)
    }
  }

  function copyTrackUrl(ln) {
    // The backend's own splash page is the canonical tracking URL.
    const base = getConnection().url
    const full = base ? `${base}?action=open&id=${encodeURIComponent(ln.id)}` : ln.url
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(full).catch(() => {})
    setCopiedId(ln.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (!live) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold">Tracked links</h3>
        <p className="rounded-lg border border-dashed border-stone-300 bg-cream px-3 py-4 text-center text-xs text-navy/50">
          Connect your sheet to send trackable links — you'll see every open.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Tracked links</h3>
      <div className="space-y-2">
        {leadLinks.length === 0 && (
          <p className="text-xs text-navy/50">No links sent yet. Send a landing page or proposal link to track opens.</p>
        )}
        {leadLinks.map((ln) => {
          const opens = ln.opens || []
          const first = opens.length ? new Date(opens[0].ts).getTime() : 0
          const last = opens.length ? new Date(opens[opens.length - 1].ts).getTime() : 0
          const dwellS = first && last ? Math.round((last - first) / 1000) : 0
          const dwell = dwellS >= 60 ? `${Math.floor(dwellS / 60)}m ${dwellS % 60}s` : `~${dwellS}s`
          return (
            <div key={ln.id} className="rounded-lg border border-stone-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-xs font-semibold">{String(ln.url || '').replace(/^https?:\/\//i, '')}</p>
                {!opens.length ? (
                  <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">Not opened yet</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-wagreen/15 px-2 py-0.5 text-[10px] font-medium text-deepgreen">
                    Opened · {opens.length} view{opens.length > 1 ? 's' : ''}{dwellS > 2 ? ` · ${dwell}` : ''}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-navy/40">
                <span>{channelLabel(ln.channel)}</span>
                <span className="flex gap-2">
                  <button className="font-medium text-deepgreen hover:underline" onClick={() => copyTrackUrl(ln)}>
                    {copiedId === ln.id ? 'Copied!' : 'Copy tracking link'}
                  </button>
                  <button
                    className="font-medium text-terracotta hover:underline"
                    onClick={() => { if (window.confirm('Delete this tracked link?')) actions.deleteLink(ln.id) }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 space-y-2 rounded-xl border border-stone-200 bg-cream p-3">
        <input
          type="url"
          className={inputCls}
          placeholder="https://docs.google.com/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="flex items-center gap-1.5">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannel(c.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                channel === c.id ? 'border-wagreen bg-wagreen text-white' : 'border-stone-300 bg-white text-navy/70 hover:border-navy/40'
              }`}
            >
              {c.label}
            </button>
          ))}
          <Button className="ml-auto" onClick={send} disabled={busy || !url.trim()}>
            {busy ? 'Creating…' : 'Send tracked link'}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-navy/40">
          The recipient lands on a WA AIDA tracking page that embeds your link — opens and reading time appear here.
        </p>
      </div>
    </div>
  )
}

// ---------- Email quotation (multichannel) ----------

// The Leads sheet has no email column, so the recipient is entered per send
// and remembered on this device per lead.
const EMAIL_BOOK_KEY = '***'

function loadEmailBook() {
  try {
    const p = JSON.parse(localStorage.getItem(EMAIL_BOOK_KEY))
    return p && typeof p === "object" ? p : {}
  } catch { return {} }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Tracked links live behind the backend splash route; fall back to the raw
// destination when the sheet is not connected.
function trackingUrl(ln) {
  if (!ln) return ""
  const base = getConnection().url
  return base ? base + "?action=open&id=" + encodeURIComponent(ln.id) : (ln.url || "")
}

// Table + inline styles only - the shape Gmail, Outlook and phone clients keep.
function quoteMail({ leadName, title, amount, services, validity, message, link }) {
  const first = String(leadName || '').split(' ')[0] || 'there'
  const peso = formatPeso(Number(String(amount || '').replace(/[^0-9]/g, '')) || 0)
  const items = String(services || '').split('\n').map((s) => s.trim()).filter(Boolean)
  const days = Number(String(validity || '').replace(/[^0-9]/g, '')) || 0
  const t = 'font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16213e;margin:0 0 12px'

  const rows = items.map((s) =>
    '<tr><td style="padding:8px 0;border-bottom:1px solid #f0e9df;' + t + '">' + esc(s) + '</td></tr>'
  ).join("")

  const html = [
    '<div style="margin:0;padding:24px 14px;background:#fdf8f3">',
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #f0e9df;border-radius:14px;overflow:hidden">',
    '<div style="background:#16213e;padding:16px 22px"><span style="font:700 16px/1.2 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#fff"><span style="color:#25d366">&#9679;</span> NineToFive</span></div>',
    '<div style="padding:22px">',
    '<p style="' + t + '">Hi ' + esc(first) + ',</p>',
    '<h2 style="font:700 20px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#16213e;margin:0 0 4px">' + esc(title || 'Your quotation') + '</h2>',
    amount ? '<p style="font:700 22px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b5e20;margin:6px 0 14px">' + esc(peso) + '</p>' : "",
    rows ? '<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 14px">' + rows + '</table>' : "",
    message ? '<p style="' + t + '">' + esc(message) + '</p>' : "",
    link ? '<p style="margin:0 0 16px"><a href="' + esc(link) + '" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;font:600 14px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:11px 18px;border-radius:9px">View details</a></p>' : "",
    days ? '<p style="' + t + 'font-size:12px;color:#6b7280">This quotation is valid for ' + days + ' day' + (days > 1 ? 's' : '') + ' from today.</p>' : "",
    '<p style="' + t + 'font-size:12px;color:#6b7280">Sent from NineToFive - lead &amp; pipeline tracker.</p>',
    "</div></div></div>",
  ].join("")

  const text = [
    'Hi ' + first + ',',
    "",
    title || "Your quotation",
    amount ? peso : "",
    items.map((s) => "- " + s).join("\n"),
    message || "",
    link ? 'View details: ' + link : "",
    days ? 'This quotation is valid for ' + days + ' day' + (days > 1 ? 's' : '') + '.' : "",
  ].filter((x) => x !== "").join("\n")

  return { html, text }
}

function EmailQuotation({ lead, onClose }) {
  const { links, sync, actions, pushToast } = useStore()
  const live = sync.connState === 'live'
  const book = loadEmailBook()
  const [to, setTo] = useState(book[String(lead.id)] || '')
  const [title, setTitle] = useState(lead.product ? String(lead.product) + ' - quotation' : '')
  const [amount, setAmount] = useState(lead.value ? String(lead.value) : '')
  const [services, setServices] = useState('')
  const [validity, setValidity] = useState('14')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [quota, setQuota] = useState(null)

  // Option (b): prefill the link from this lead's most recent tracked link.
  const mine = Array.isArray(links) ? links.filter((ln) => String(ln.leadId) === String(lead.id)) : []
  const latest = mine.length ? mine[mine.length - 1] : null
  const [link, setLink] = useState(trackingUrl(latest))

  const composed = quoteMail({ leadName: lead.name, title, amount, services, validity, message, link })
  const subject = 'Quotation: ' + (title.trim() || 'NineToFive')

  useEffect(() => {
    if (!live) return
    let alive = true
    api.emailQuota().then((r) => { if (alive && r && typeof r.remaining === "number") setQuota(r) }).catch(() => {})
    return () => { alive = false }
  }, [live])

  function remember(addr) {
    try {
      localStorage.setItem(EMAIL_BOOK_KEY, JSON.stringify({ ...loadEmailBook(), [String(lead.id)]: addr }))
    } catch { /* storage is optional */ }
  }

  async function send() {
    const addr = to.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { pushToast("Enter a valid recipient email", "error"); return }
    if (!title.trim()) { pushToast("Give the quotation a title first", "error"); return }
    setBusy(true)
    try {
      if (live) {
        const r = await actions.sendEmail(lead, { to: addr, subject, htmlBody: composed.html })
        if (r && r.ok) {
          remember(addr)
          if (typeof r.remaining === "number") setQuota({ remaining: r.remaining })
          onClose && onClose()
        }
      } else {
        // No backend: hand the quotation to the phone's own mail app, the
        // same fallback shape the WhatsApp chips already use.
        remember(addr)
        window.location.href = 'mailto:' + encodeURIComponent(addr) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(composed.text)
        pushToast("Opening your mail app", "info")
        onClose && onClose()
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2 rounded-lg border border-wagreen/40 bg-wagreen/5 p-3">
      <input
        id="quotation-to"
        className={inputCls}
        type="email"
        inputMode="email"
        autoComplete="off"
        placeholder="Client email (e.g. owner@shop.ph)"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <input
        id="quotation-title"
        className={inputCls}
        placeholder="Quotation title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} inputMode="numeric" placeholder="Amount (PHP)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className={inputCls} inputMode="numeric" placeholder="Validity (days)" value={validity} onChange={(e) => setValidity(e.target.value)} />
      </div>
      <textarea
        className={inputCls + " min-h-16 resize-y"}
        placeholder="What is included - one item per line"
        value={services}
        onChange={(e) => setServices(e.target.value)}
      />
      <textarea
        className={inputCls + " min-h-12 resize-y"}
        placeholder="Short note to the client (optional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <input
        id="quotation-link"
        className={inputCls}
        placeholder="Link to include (optional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <p className="text-[11px] leading-relaxed text-navy/40">
        {latest ? "Prefilled from this lead's latest tracked link - opens are still counted." : "No tracked link for this lead yet - paste one, or leave it empty."}
      </p>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <iframe title="Quotation preview" sandbox="" srcDoc={composed.html} className="h-56 w-full" />
      </div>
      <p className="text-[11px] leading-relaxed text-navy/40">
        {live
          ? "Sends from your connected Google account by email." + (quota && quota.remaining >= 0 ? " " + quota.remaining + " recipient" + (quota.remaining === 1 ? "" : "s") + " left today." : "")
          : "Your sheet is not connected - this opens your own mail app instead, so you can still send it."}
      </p>
      <Button id="quotation-send" className="w-full" onClick={send} disabled={busy}>
        {busy ? "Sending..." : "Send quotation"}
      </Button>
    </div>
  )
}

export function LeadDrawer({ lead, onClose, onEdit }) {
  const { actions, sync, templates } = useStore()
  const [noteText, setNoteText] = useState(null) // null = pristine (show lead.notes)
  const [followUp, setFollowUp] = useState(null) // null = pristine
  const [emailing, setEmailing] = useState(false)

  // Opening a drawer acknowledges that lead's link-open badges.
  useEffect(() => {
    if (lead && sync.connState === 'live') actions.markLinkSeen(lead.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead && lead.id, sync.connState])

  if (!lead) return null
  const notesValue = noteText ?? lead.notes ?? ''
  const followUpValue = followUp ?? lead.nextFollowUp ?? ''
  const notesDirty = noteText !== null && noteText !== (lead.notes || '')
  const followUpDirty = followUp !== null && followUp !== (lead.nextFollowUp || '')
  const waNumber = waTarget(lead.phone)
  const waLink = `https://wa.me/${waNumber}`
  // Multichannel: same number, no infrastructure - the phone's own Viber /
  // SMS app opens. Empty string when the lead has no usable number.
  const viberHref = viberLink(lead.phone)
  const smsHref = smsLink(lead.phone)
  const activity = lead.activity || []

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-navy/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{lead.name}</h2>
                <StageBadge stage={lead.stage} />
              </div>
              <p className="mt-0.5 text-sm text-navy/60">{lead.product || '—'}</p>
            </div>
            <Button variant="ghost" onClick={onClose} aria-label="Close" className="h-8 w-8 shrink-0 !p-0 text-xl leading-none">×</Button>
          </div>
        </div>

        <div className="space-y-6 px-5 py-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium text-navy/50">Deal value</p>
              <p className="font-semibold">{formatPeso(lead.value)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-navy/50">Source</p>
              <div className="mt-0.5"><SourceBadge source={lead.source} /></div>
            </div>
            <div>
              <p className="text-xs font-medium text-navy/50">Phone</p>
              <p>{lead.phone || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-navy/50">Created</p>
              <p>{relCreated(lead.created)}</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-navy/50">Next follow-up</label>
            <div className="flex gap-2">
              <input
                type="date"
                className={inputCls}
                value={followUpValue}
                onChange={(e) => setFollowUp(e.target.value)}
              />
              {followUpDirty && (
                <Button onClick={() => { actions.setFollowUp(lead.id, followUpValue || null); setFollowUp(null) }}>Save</Button>
              )}
            </div>
            {isOverdue(followUpValue) && <p className="mt-1 text-xs font-medium text-amber">⚠ overdue</p>}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Quick message</h3>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  title={t.body}
                  onClick={() => {
                    const msg = t.body.replace(/\{name\}/g, lead.name.split(' ')[0] || 'there').replace(/\{product\}/g, lead.product || 'it')
                    window.open('https://wa.me/' + waNumber + '?text=' + encodeURIComponent(msg), '_blank', 'noopener')
                    actions.bumpTplUse(t.id)
                  }}
                  className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:border-wagreen hover:text-deepgreen focus:outline-none focus-visible:ring-2 focus-visible:ring-wagreen/50"
                >
                  {t.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-navy/40">One tap opens WhatsApp with the message filled in for this lead.</p>
          </div>

          <div className="flex gap-2">
            <a href={waLink} target="_blank" rel="noopener noreferrer" className={`${btnBase} flex-1 bg-wagreen px-3 py-2 text-white shadow-sm hover:bg-deepgreen active:bg-deepgreen/90`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.2L2.1 22l4.9-1.5A9.9 9.9 0 1 0 12.04 2Zm5.8 14.1c-.25.7-1.45 1.35-2 1.4-.55.05-1.05.15-2.9-.6-2.3-.95-3.75-3.3-3.85-3.45-.1-.15-.9-1.25-.9-2.4 0-1.15.6-1.7.8-1.95.2-.25.45-.3.6-.3h.45c.15 0 .35-.05.55.4.2.5.7 1.75.75 1.85.05.15.1.3 0 .45-.1.15-.15.25-.3.4l-.45.5c-.15.15-.3.3-.15.6.15.3.7 1.2 1.5 1.9 1.05.9 1.9 1.2 2.2 1.35.3.15.45.1.6-.05.15-.15.7-.8.9-1.1.2-.3.35-.25.65-.15.3.15 1.85.9 2.15 1.05.3.15.5.2.55.3.05.15.05.7-.2 1.4Z"/></svg>
              Chat on WhatsApp
            </a>
            <Button variant="secondary" onClick={() => onEdit(lead)}>Edit</Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {viberHref ? (
              <a
                href={viberHref}
                data-channel="viber"
                target="_blank"
                rel="noopener noreferrer"
                className={`${btnBase} gap-2 border border-stone-300 bg-white px-3 py-2 text-navy shadow-sm hover:border-navy/40 hover:bg-stone-50 active:bg-stone-100`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#7360f2' }} />
                Viber
              </a>
            ) : (
              <span className={`${btnBase} cursor-not-allowed border border-dashed border-stone-300 px-3 py-2 text-navy/30`} title="This lead has no phone number yet">Viber</span>
            )}
            {smsHref ? (
              <a
                href={smsHref}
                data-channel="sms"
                className={`${btnBase} gap-2 border border-stone-300 bg-white px-3 py-2 text-navy shadow-sm hover:border-navy/40 hover:bg-stone-50 active:bg-stone-100`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#16213e' }} />
                SMS
              </a>
            ) : (
              <span className={`${btnBase} cursor-not-allowed border border-dashed border-stone-300 px-3 py-2 text-navy/30`} title="This lead has no phone number yet">SMS</span>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Quotation email</h3>
              <button
                id="email-quotation-toggle"
                className="text-xs font-medium text-deepgreen hover:underline"
                onClick={() => setEmailing((v) => !v)}
              >
                {emailing ? 'Cancel' : 'Email quotation'}
              </button>
            </div>
            {emailing ? (
              <EmailQuotation lead={lead} onClose={() => setEmailing(false)} />
            ) : (
              <p className="text-[11px] leading-relaxed text-navy/40">
                Send a formal quotation by email - title, amount, what is included and a link to whatever you shared.
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Notes</h3>
              {sync.demoMode && <span className="text-[11px] font-medium text-amber">demo — not saved to a sheet</span>}
            </div>
            <textarea
              className={`${inputCls} min-h-24 resize-y`}
              value={notesValue}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add context — what was discussed, what matters…"
            />
            {notesDirty && (
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setNoteText(null)}>Discard</Button>
                <Button onClick={() => { actions.saveNotes(lead.id, noteText); setNoteText(null) }}>Save note</Button>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Activity log</h3>
            <ol className="space-y-0">
              {activity.length === 0 && <p className="text-sm text-navy/50">No activity yet.</p>}
              {activity.slice().reverse().map((a, i, arr) => (
                <li key={i} className="relative flex gap-3 pb-3 pl-1 last:pb-0">
                  {i < arr.length - 1 && <span className="absolute left-[4.5px] top-4 h-full w-px bg-stone-200" />}
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-wagreen" />
                  <div>
                    <p className="text-sm">{a.label || a.text}</p>
                    <p className="text-[11px] text-navy/40">{formatTs(a.ts || a.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t border-stone-100 pt-4">
            <TrackedLinks lead={lead} />
          </div>

          <div className="border-t border-stone-100 pt-4">
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete ${lead.name}? This also removes their tracked links, proposals and reminders from the sheet.`)) {
                  actions.deleteLead(lead.id)
                  onClose()
                }
              }}
            >
              Delete lead
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function relCreated(iso) {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (isNaN(dt)) return '—'
  return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

function formatTs(ts) {
  if (!ts) return ''
  const dt = new Date(ts)
  if (isNaN(dt)) return String(ts)
  return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) +
    ' · ' + dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

// ---------- Settings modal (Sheets connection) ----------

export function SettingsModal({ onClose }) {
  const { sync, actions } = useStore()
  const [url, setUrl] = useState(() => localStorage.getItem('waaida-script-url') || '')
  const [token, setToken] = useState(() => localStorage.getItem('waaida-token') || '')
  const [demo, setDemo] = useState(sync.demoMode)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function connect(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await actions.connect(url.trim(), token.trim())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const statusLine = () => {
    if (sync.busy) return { text: '● Saving…', cls: 'text-amber' }
    if (sync.connState === 'live' && sync.meta) return { text: `● Live · ${sync.meta.sheetName || 'Google Sheet'} · ${sync.meta.count} leads`, cls: 'text-deepgreen' }
    if (sync.connState === 'live') return { text: '● Live · Sheet connected', cls: 'text-deepgreen' }
    if (sync.connState === 'offline') return { text: '● Offline · showing cached data', cls: 'text-red-600' }
    return { text: '● Demo data — sample leads on this device only', cls: 'text-amber' }
  }
  const st = statusLine()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close" className="h-8 w-8 !p-0 text-xl leading-none">×</Button>
        </div>

        <div className={`mb-4 rounded-xl border border-stone-200 bg-cream px-4 py-3 text-sm font-medium ${st.cls}`}>{st.text}</div>

        {sync.connState === 'live' && sync.meta?.sheetUrl && (
          <a className="mb-4 inline-flex text-sm font-medium text-deepgreen underline" href={sync.meta.sheetUrl} target="_blank" rel="noopener noreferrer">
            Open the Google Sheet ↗
          </a>
        )}

        <form onSubmit={connect} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy/70">Apps Script Web App URL (ends in /exec)</label>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" autoComplete="off" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy/70">Security token (optional)</label>
            <input type="password" className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="WA_AIDA_TOKEN value, if you set one" autoComplete="off" />
          </div>
          {error && <p className="text-xs text-terracotta">{error}</p>}
          <div className="flex justify-end gap-2">
            {sync.connState !== 'demo' && (
              <Button variant="secondary" type="button" onClick={() => { actions.disconnect(); setUrl(''); setToken(token) }}>Disconnect</Button>
            )}
            <Button type="submit" disabled={busy || !url.trim()}>{busy ? 'Connecting…' : 'Connect'}</Button>
          </div>
        </form>

        <div className="mt-6 border-t border-stone-100 pt-4">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Use demo data</span>
              <span className="block text-xs text-navy/50">Sample leads only — zero requests to your sheet. Forced on with <span className="font-mono">?demo=1</span>.</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-[#25d366]"
              checked={demo}
              onChange={(e) => { setDemo(e.target.checked); actions.useDemoData(e.target.checked) }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

// ---------- CSV import (9-5 instance) ----------

export function ImportModal({ onClose }) {
  const { actions, pushToast } = useStore()
  const [parsed, setParsed] = useState(null)
  const [map, setMap] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  function onFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ''))
      if (rows.length < 2) { pushToast('That file looks empty - need a header row plus at least one lead', 'error'); return }
      setParsed({ headers: rows[0], rows: rows.slice(1) })
      setMap(autoMap(rows[0]))
      setResult(null)
    }
    reader.readAsText(file)
  }

  function setCol(i, field) {
    setMap((m) => {
      const next = { ...m }
      Object.keys(next).forEach((k) => { if (next[k] === field && k !== 'col' + i) delete next[k] })
      if (field) next['col' + i] = field; else delete next['col' + i]
      return next
    })
  }

  async function doImport() {
    if (!parsed) return
    if (!Object.values(map).includes('name')) { pushToast('Map at least a Name column first', 'error'); return }
    setBusy(true)
    const r = await actions.importLeads(rowsToLeads(parsed.rows, map))
    setBusy(false)
    if (r && r.ok) setResult({ added: r.added })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-cream p-4 shadow-xl sm:rounded-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import CSV</h2>
          <button className="text-navy/50 hover:text-navy" onClick={onClose}>x</button>
        </div>
        {!parsed && (
          <div>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className={`${inputCls} w-full`} />
            <p className="mt-2 text-[11px] text-navy/40">Pick a .csv export. You'll map the columns next; every imported lead starts in New.</p>
          </div>
        )}
        {parsed && !result && (
          <div>
            <p className="mb-2 text-xs text-navy/60">{parsed.rows.length} rows found. Map the columns you want - the rest are ignored.</p>
            <div className="mb-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {parsed.headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-navy/70">{String(h).trim() || '(column ' + (i + 1) + ')'}</span>
                  <select className={`${inputCls} w-44 text-xs`} value={map['col' + i] || ''} onChange={(e) => setCol(i, e.target.value)}>
                    <option value="">Ignore</option>
                    {IMPORT_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={doImport} disabled={busy}>
              {busy ? 'Importing...' : 'Import ' + parsed.rows.length + ' leads'}
            </Button>
          </div>
        )}
        {result && (
          <div className="py-4 text-center">
            <p className="text-sm font-semibold text-deepgreen">Imported {result.added} leads</p>
            <p className="mt-1 text-xs text-navy/50">They all start in New - drag them through the pipeline as you work them.</p>
            <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </div>
  )
}