// Minimal CSV import helpers (9-5 instance).
// RFC-4180-ish parser: quoted fields, commas/newlines inside quotes, CRLF.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQ = false
  const src = String(text || '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { inQ = false }
      } else { field += ch }
    } else if (ch === '"') { inQ = true }
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') { field += ch }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

export const IMPORT_TARGETS = [
  { id: 'name', label: 'Name', hint: /name|contact/i },
  { id: 'phone', label: 'Phone', hint: /phone|mobile|cell|number/i },
  { id: 'product', label: 'Product / Company', hint: /product|company|deal|service|offering/i },
  { id: 'value', label: 'Deal value', hint: /value|amount|budget|size/i },
  { id: 'notes', label: 'Notes', hint: /note|remark|comment|detail/i },
]

export function autoMap(headers) {
  const map = {}
  const used = new Set()
  String(headers || '').length // noop guard
  ;(headers || []).forEach((h, i) => {
    const hit = IMPORT_TARGETS.find((t) => t.hint.test(String(h).trim()) && !used.has(t.id))
    if (hit) { map['col' + i] = hit.id; used.add(hit.id) }
  })
  return map
}

export function rowsToLeads(rows, map) {
  return (rows || []).map((r, i) => {
    const get = (field) => {
      const key = Object.keys(map || {}).find((k) => map[k] === field)
      return key ? String(r[Number(key.slice(3))] || '').trim() : ''
    }
    return {
      tempId: -(Date.now() + i),
      name: get('name') || 'Unnamed',
      phone: get('phone'),
      source: 'csv',
      product: get('product') || 'Other',
      stage: 'new',
      value: Number(String(get('value')).replace(/[^0-9]/g, '')) || 0,
      notes: get('notes'),
      created: new Date().toISOString(),
      activity: [{ t: 'imported', ts: new Date().toISOString(), label: 'Imported via CSV' }],
    }
  })
}