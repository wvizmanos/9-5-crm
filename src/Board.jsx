import { useMemo, useState } from 'react'
import { SOURCES, STAGES } from './data'
import { formatPeso, isOverdue, relTime, useStore } from './store'
import { ImportModal, SourceBadge, inputCls } from './ui'

export default function Board({ onOpenLead, onNewLead }) {
  const { leads, actions, linkBadges } = useStore()
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [dragId, setDragId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const [showImport, setShowImport] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((l) => {
      if (sourceFilter !== 'all' && l.source !== sourceFilter) return false
      if (stageFilter !== 'all' && l.stage !== stageFilter) return false
      if (q && ![l.name, l.product].join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [leads, search, sourceFilter, stageFilter])

  const byStage = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.id, []]))
    filtered.forEach((l) => map[l.stage]?.push(l))
    return map
  }, [filtered])

  function drop(e, stage) {
    e.preventDefault()
    setDragOverCol(null)
    if (dragId) {
      const lead = leads.find((l) => l.id === dragId)
      if (lead && lead.stage !== stage) actions.moveLead(dragId, stage)
    }
    setDragId(null)
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
        <input
          className={`${inputCls} sm:w-56`}
          placeholder="Search name or business…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={`${inputCls} sm:w-36`} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All</option>
          {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className={`${inputCls} sm:w-36`} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="all">All</option>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-navy transition-colors hover:border-wagreen hover:text-deepgreen" onClick={() => setShowImport(true)}>Import CSV</button>
        <div className="ml-auto">
          <button
            onClick={onNewLead}
            className="inline-flex items-center gap-1.5 rounded-lg bg-wagreen px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-deepgreen active:bg-deepgreen/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-wagreen/60"
          >
            <span className="text-base leading-none">+</span> New lead
          </button>
        </div>
      </div>

      {/* board */}
      <div className="flex-1 overflow-x-auto px-4 pb-4 sm:px-6">
        <div className="flex h-full min-w-max gap-3">
          {STAGES.map((stage) => {
            const items = byStage[stage.id]
            const total = items.reduce((sum, l) => sum + (l.value || 0), 0)
            return (
              <div
                key={stage.id}
                className={`flex w-64 shrink-0 flex-col rounded-xl border border-stone-200/80 bg-white/60 ${dragOverCol === stage.id ? 'kanban-col-dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(stage.id) }}
                onDragLeave={() => setDragOverCol((c) => (c === stage.id ? null : c))}
                onDrop={(e) => drop(e, stage.id)}
              >
                <div className="flex items-center justify-between border-b border-stone-200/80 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-sm font-semibold">{stage.label}</h3>
                  </div>
                  <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[11px] font-medium text-navy/60">
                    {items.length} · {formatPeso(total)}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {items.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-navy/40">
                      {stage.id === 'lost' ? 'Nothing lost — nice work 🎉' : 'No leads here'}
                    </p>
                  )}
                  {items.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
                      onClick={() => onOpenLead(lead.id)}
                      className={`cursor-pointer rounded-lg border border-stone-200 bg-white p-3 shadow-sm transition-all hover:border-wagreen/60 hover:shadow ${dragId === lead.id ? 'card-dragging' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                          {lead.name}
                          {linkBadges?.[String(lead.id)] > 0 && (
                            <span
                              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[10px] font-bold text-white"
                              title="Tracked link opened since you last looked"
                            >
                              {linkBadges[String(lead.id)]}
                            </span>
                          )}
                        </p>
                        <SourceBadge source={lead.source} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-navy/50">{lead.product}</p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-deepgreen">{formatPeso(lead.value)}</span>
                        {isOverdue(lead.nextFollowUp) ? (
                          <span className="rounded-full bg-amber/15 px-1.5 py-0.5 font-medium text-amber">
                            ⚠ {lead.nextFollowUp && new Date(lead.nextFollowUp + 'T12:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} overdue
                          </span>
                        ) : (
                          <span className="text-navy/40">Added {relTime(lead.created)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  )
}
