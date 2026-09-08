// Canonical data vocabulary — MUST match the Google Sheet backend
// (reference/Code.gs): stages new|contacted|qualified|proposal|won|lost,
// sources fb-ads|manual|csv|whatsapp.

export const STAGES = [
  { id: 'new', label: 'New', color: '#16213e' },
  { id: 'contacted', label: 'Contacted', color: '#0e7490' },
  { id: 'qualified', label: 'Qualified', color: '#1b5e20' },
  { id: 'proposal', label: 'Proposal', color: '#f59e0b' },
  { id: 'won', label: 'Won', color: '#25d366' },
  { id: 'lost', label: 'Lost', color: '#c75b39' },
]

export const STAGE_IDS = STAGES.map((s) => s.id)

export const SOURCES = [
  { id: 'fb-ads', label: 'FB Ads' },
  { id: 'manual', label: 'Manual' },
  { id: 'csv', label: 'CSV Import' },
  { id: 'whatsapp', label: 'WhatsApp' },
]

export const SOURCE_IDS = SOURCES.map((s) => s.id)

export function sourceLabel(id) {
  return (SOURCES.find((s) => s.id === id) || {}).label || id
}

export const SOURCE_STYLES = {
  'fb-ads': 'bg-blue-100 text-blue-800 border-blue-200',
  manual: 'bg-stone-100 text-stone-700 border-stone-300',
  csv: 'bg-violet-100 text-violet-800 border-violet-200',
  whatsapp: 'bg-wagreen/15 text-deepgreen border-wagreen/40',
}

// Demo-mode sample data — the same 13 leads the old PWA shipped
// (reference/v19-app.html), with dates generated relative to "today".
function daysAgoISO(n) {
  const dt = new Date()
  dt.setHours(12, 0, 0, 0)
  dt.setDate(dt.getDate() - n)
  return dt.toISOString()
}

function d(offsetDays) {
  const dt = new Date()
  dt.setHours(12, 0, 0, 0)
  dt.setDate(dt.getDate() + offsetDays)
  const p = (x) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

function act(label, daysAgo) {
  return [{ t: 'created', ts: daysAgoISO(daysAgo), label: 'Lead captured' }]
}

export const sampleLeads = () => [
  { id: 1, name: 'Maria Santos', phone: '+63 917 123 4567', source: 'fb-ads', product: 'Siomai Franchise', stage: 'new', value: 150000, intent: 92, notes: 'Asked about franchise cost and ROI timeline. Saw the FB ad at 11pm.', created: daysAgoISO(0), activity: act('Lead captured', 0) },
  { id: 2, name: 'Ramon Garcia', phone: '+63 918 234 5678', source: 'fb-ads', product: 'Printing Business', stage: 'contacted', value: 60000, intent: 78, notes: 'Wants offset printing price list. Follow up Thursday.', created: daysAgoISO(0), activity: act('Lead captured', 0) },
  { id: 3, name: 'Jenny Dela Cruz', phone: '+63 919 345 6789', source: 'csv', product: 'Retail Store', stage: 'qualified', value: 250000, intent: 85, notes: 'Owns 2 sari-sari stores. Interested in inventory analytics.', created: daysAgoISO(1), activity: act('Lead captured', 1) },
  { id: 4, name: 'Kevin Tan', phone: '+63 917 456 7890', source: 'manual', product: 'Construction Manpower', stage: 'proposal', value: 800000, intent: 90, notes: 'Quoted for a 25-man crew. Needs manpower scheduling.', created: daysAgoISO(3), activity: act('Lead captured', 3) },
  { id: 5, name: 'Aling Nena Store', phone: '+63 916 567 8901', source: 'fb-ads', product: 'Retail Store', stage: 'won', value: 120000, intent: 95, notes: 'Signed monthly analytics plan. Referral from Maria.', created: daysAgoISO(7), activity: act('Lead captured', 7) },
  { id: 6, name: 'Carlo Reyes', phone: '+63 915 678 9012', source: 'csv', product: 'Construction Manpower', stage: 'contacted', value: 350000, intent: 60, notes: 'Imported from old spreadsheet. Called once, no answer.', created: daysAgoISO(0), activity: act('Lead captured', 0) },
  { id: 7, name: 'Fatima Ahmed', phone: '+63 914 789 0123', source: 'manual', product: 'Retail Store', stage: 'new', value: 90000, intent: 70, notes: 'Met at trade show. Follow up with a sample report.', created: daysAgoISO(0), activity: act('Lead captured', 0) },
  { id: 8, name: 'BJ Lim', phone: '+63 917 890 1234', source: 'fb-ads', product: 'Printing Business', stage: 'qualified', value: 150000, intent: 82, notes: 'Asked about supplier price benchmarking.', created: daysAgoISO(1), activity: act('Lead captured', 1) },
  { id: 9, name: 'Rosa Mendoza', phone: '+63 918 901 2345', source: 'csv', product: 'Siomai Franchise', stage: 'contacted', value: 200000, intent: 74, notes: 'Comparing 3 franchise options. Send franchise deck.', created: daysAgoISO(0), activity: act('Lead captured', 0) },
  { id: 10, name: 'Daniel Cruz', phone: '+63 919 012 3456', source: 'fb-ads', product: 'Construction Manpower', stage: 'new', value: 450000, intent: 66, notes: 'Inquiry about crew payroll tracking.', created: daysAgoISO(0), activity: act('Lead captured', 0) },
  { id: 11, name: 'Michelle Ong', phone: '+63 916 123 8901', source: 'manual', product: 'Retail Store', stage: 'proposal', value: 180000, intent: 88, notes: 'Needs custom dashboard. Sent proposal v2.', created: daysAgoISO(2), activity: act('Lead captured', 2) },
  { id: 12, name: 'Paolo Villanueva', phone: '+63 915 234 9012', source: 'csv', product: 'Printing Business', stage: 'won', value: 75000, intent: 80, notes: 'Renewed for another quarter.', created: daysAgoISO(14), activity: act('Lead captured', 14) },
  { id: 13, name: 'Liza Ramirez', phone: '+63 917 345 6781', source: 'fb-ads', product: 'Siomai Franchise', stage: 'lost', value: 100000, intent: 40, notes: 'Went with a competitor. Keep in nurture list.', created: daysAgoISO(4), activity: act('Lead captured', 4) },
]

// Demo-mode follow-ups (local-only in Phase 1; the Reminders tab wiring
// is Phase 3). Keys are lead ids as strings, values are YYYY-MM-DD.
export const sampleFollowUps = () => ({
  1: d(0),
  2: d(-1),
  3: d(-3),
  4: d(2),
  6: d(-2),
  9: d(1),
  13: d(-5),
})

/* ════════ Legacy seed (kept only for the disabled GitHub sync module) ════════ */

let n = 0
const id = () => `lead-${++n}`

export const seedLeads = () => [
  {
    id: id(), name: 'Maria Santos', business: 'Sari-sari Store (Quezon City)', phone: '+639171234567',
    source: 'Manual', value: 12000, stage: 'new', lastContact: d(-1), nextFollowUp: d(1),
    notes: [{ at: d(-1), text: 'Inquired about inventory tracking for her store. Wants to try before committing.' }],
    activity: [{ at: d(-1), text: 'Lead created from FB Ads inquiry' }],
  },
  {
    id: id(), name: 'Juan Dela Cruz', business: 'Dela Cruz Construction Manpower', phone: '+639182345678',
    source: 'Manual', value: 85000, stage: 'contacted', lastContact: d(-2), nextFollowUp: d(0),
    notes: [{ at: d(-2), text: 'Needs worker scheduling + payroll reminders for 40 crew members.' }],
    activity: [{ at: d(-2), text: 'Lead created manually' }, { at: d(-2), text: 'First WhatsApp message sent' }],
  },
  {
    id: id(), name: 'Ana Reyes', business: "Ana's Siomai Franchise (3 branches)", phone: '+639203456789',
    source: 'FB Ads', value: 45000, stage: 'qualified', lastContact: d(-3), nextFollowUp: d(-2),
    notes: [{ at: d(-3), text: 'Confirmed budget approved. Asked for supplier order tracking too.' }],
    activity: [{ at: d(-3), text: 'Qualified after discovery call' }],
  },
  {
    id: id(), name: 'Carlo Mendoza', business: 'Mendoza Print Shop (Davao)', phone: '+639194567890',
    source: 'CSV Import', value: 25000, stage: 'quoted', lastContact: d(-5), nextFollowUp: d(-1),
    notes: [{ at: d(-5), text: 'Sent quotation for Pro plan. Comparing us with a spreadsheet setup.' }],
    activity: [{ at: d(-5), text: 'Quotation ₱25,000 sent via WhatsApp' }],
  },
  {
    id: id(), name: 'Grace Lim', business: 'Grace Beauty Supplies', phone: '+639175678901',
    source: 'Manual', value: 30000, stage: 'won', lastContact: d(-8), nextFollowUp: null,
    notes: [{ at: d(-8), text: 'Closed! Paid full year upfront. Onboarded her two staff.' }],
    activity: [{ at: d(-8), text: 'Deal won 🎉 — ₱30,000' }],
  },
  {
    id: id(), name: 'Roberto Villanueva', business: 'RV Bike Parts & Repair', phone: '+639186789012',
    source: 'FB Ads', value: 8000, stage: 'new', lastContact: null, nextFollowUp: d(2),
    notes: [], activity: [{ at: d(0), text: 'Lead created from FB Ads inquiry' }],
  },
  {
    id: id(), name: 'Liza Aquino', business: 'Aquino Rice Dealer (Bulacan)', phone: '+639197890123',
    source: 'CSV Import', value: 60000, stage: 'contacted', lastContact: d(-4), nextFollowUp: d(-3),
    notes: [{ at: d(-4), text: 'Wants customer credit tracking (utang list). Very interested.' }],
    activity: [{ at: d(-4), text: 'First WhatsApp message sent' }],
  },
  {
    id: id(), name: 'Paolo Garcia', business: 'PG Milk Tea Shop', phone: '+639208901234',
    source: 'Manual', value: 15000, stage: 'qualified', lastContact: d(-2), nextFollowUp: d(3),
    notes: [{ at: d(-2), text: 'Two branches, wants daily sales summary pushed to WhatsApp.' }],
    activity: [{ at: d(-2), text: 'Qualified after demo' }],
  },
  {
    id: id(), name: 'Michelle Torres', business: 'Torres Catering Services', phone: '+639179012345',
    source: 'FB Ads', value: 95000, stage: 'quoted', lastContact: d(-6), nextFollowUp: d(0),
    notes: [{ at: d(-6), text: 'Sent ₱95,000 annual quote. Booking season peaks in December.' }],
    activity: [{ at: d(-6), text: 'Quotation ₱95,000 sent via WhatsApp' }],
  },
  {
    id: id(), name: 'Danilo Ramos', business: 'Ramos Hardware & Electrical', phone: '+639180123456',
    source: 'CSV Import', value: 40000, stage: 'new', lastContact: d(-1), nextFollowUp: d(4),
    notes: [{ at: d(-1), text: 'Referred by Grace Lim. Store in Pampanga with 3 staff.' }],
    activity: [{ at: d(-1), text: 'Lead created from CSV import' }],
  },
  {
    id: id(), name: 'Katrina Bautista', business: 'KB Online Fashion Resale', phone: '+639191234567',
    source: 'Manual', value: 6500, stage: 'won', lastContact: d(-12), nextFollowUp: null,
    notes: [{ at: d(-12), text: 'Small but recurring seller. Monthly plan.' }],
    activity: [{ at: d(-12), text: 'Deal won 🎉 — ₱6,500' }],
  },
  {
    id: id(), name: 'Ferdinand Cruz', business: 'FF Auto Repair Shop', phone: '+639202345678',
    source: 'FB Ads', value: 18000, stage: 'contacted', lastContact: d(-7), nextFollowUp: d(1),
    notes: [{ at: d(-7), text: 'Replied once, went quiet. Try voice note next time.' }],
    activity: [{ at: d(-7), text: 'First WhatsApp message sent' }],
  },
  {
    id: id(), name: 'Sofia Navarro', business: 'Navarro Bakeshop (Cebu)', phone: '+639173456789',
    source: 'Manual', value: 22000, stage: 'qualified', lastContact: d(-3), nextFollowUp: d(-4),
    notes: [{ at: d(-3), text: 'Wants order tracking for custom cakes. Decision this week.' }],
    activity: [{ at: d(-3), text: 'Qualified after store visit' }],
  },
  {
    id: id(), name: 'Ricardo Flores', business: 'Flores Water Refilling Station', phone: '+639184567890',
    source: 'CSV Import', value: 5000, stage: 'lost', lastContact: d(-20), nextFollowUp: null,
    notes: [{ at: d(-20), text: 'Chose a free app instead. Revisit in 6 months.' }],
    activity: [{ at: d(-20), text: 'Marked lost — went with a free competitor' }],
  },
  {
    id: id(), name: 'Jasmine Ocampo', business: "Jasmine's Ukay-Ukay Boutique", phone: '+639195678901',
    source: 'FB Ads', value: 150000, stage: 'quoted', lastContact: d(-1), nextFollowUp: d(2),
    notes: [{ at: d(-1), text: 'Biggest deal in pipeline. Multi-branch, 5 locations. Wants barangay-level delivery reports.' }],
    activity: [{ at: d(-1), text: 'Quotation ₱150,000 sent via WhatsApp' }],
  },
]
