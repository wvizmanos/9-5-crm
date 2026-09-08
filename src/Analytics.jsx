import { useMemo } from 'react'
import { SOURCES, STAGES } from './data'
import { formatPeso, useStore } from './store'

export default function Analytics() {
  const { leads, sync } = useStore()

  const byStage = useMemo(
    () => STAGES.map((s) => ({
      ...s,
      count: leads.filter((l) => l.stage === s.id).length,
      total: leads.filter((l) => l.stage === s.id).reduce((sum, l) => sum + (l.value || 0), 0),
    })),
    [leads]
  )
  const bySource = useMemo(
    () => SOURCES.map((s) => ({ ...s, count: leads.filter((l) => l.source === s.id).length })),
    [leads]
  )
  const completedThisWeek = sync.followUpsCompletedThisWeek

  const maxStageTotal = Math.max(...byStage.map((s) => s.total), 1)
  const sourceTotal = Math.max(bySource.reduce((n, s) => n + s.count, 0), 1)
  const sourceColors = { 'fb-ads': '#0e7490', manual: '#16213e', csv: '#7c3aed', whatsapp: '#25d366' }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Open pipeline value" value={formatPeso(byStage.filter((s) => !['won', 'lost'].includes(s.id)).reduce((n, s) => n + s.total, 0))} />
        <KpiCard label="Total leads" value={leads.length} />
        <KpiCard label="Follow-ups completed this week" value={completedThisWeek} />
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold">Pipeline value by stage</h3>
        <div className="space-y-3">
          {byStage.map((s) => (
            <div key={s.id}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium">{s.label}</span>
                <span className="text-navy/50">{s.count} leads · {formatPeso(s.total)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-navy/5">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(s.total / maxStageTotal) * 100}%`, backgroundColor: s.color }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold">Leads by source</h3>
          <div className="flex items-center gap-6">
            <Donut segments={bySource.map((s) => ({ value: s.count, color: sourceColors[s.id], label: s.label }))} />
            <ul className="space-y-2 text-sm">
              {bySource.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: sourceColors[s.id] }} />
                  <span>{s.label}</span>
                  <span className="font-semibold">{s.count}</span>
                  <span className="text-xs text-navy/40">({Math.round((s.count / sourceTotal) * 100)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex flex-col rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold">Follow-ups completed this week</h3>
          <div className="flex flex-1 flex-col items-center justify-center py-6">
            <p className="text-5xl font-bold text-deepgreen">{completedThisWeek}</p>
            <p className="mt-2 text-sm text-navy/50">since Monday</p>
            <p className="mt-1 text-xs text-navy/40">Mark a follow-up done in the queue and it counts here.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function KpiCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <p className="text-xs font-medium text-navy/50">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}

function Donut({ segments }) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1
  let acc = 0
  const stops = segments
    .map((s) => {
      const start = (acc / total) * 100
      acc += s.value
      const end = (acc / total) * 100
      return `${s.color} ${start}% ${end}%`
    })
    .join(', ')
  return (
    <div className="relative h-32 w-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
      <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-white">
        <span className="text-lg font-bold">{total}</span>
      </div>
    </div>
  )
}
