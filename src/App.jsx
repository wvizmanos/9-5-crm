import { useState } from 'react'
import Board from './Board'
import Followups from './Followups'
import Analytics from './Analytics'
import { LeadDrawer, LeadModal, SettingsModal } from './ui'
import { useStore } from './store'

const TABS = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'analytics', label: 'Analytics' },
]

// Pill states are exactly the four the migration brief specifies.
const PILL = {
  demo: { label: 'Demo data', cls: 'border-amber/40 bg-amber/10 text-amber hover:bg-amber/20', dot: '#f59e0b' },
  live: { label: 'Live · Sheet connected', cls: 'border-wagreen/40 bg-wagreen/10 text-deepgreen hover:bg-wagreen/20', dot: '#25d366' },
  offline: { label: 'Offline · cached', cls: 'border-red-300 bg-red-100 text-red-700 hover:bg-red-200', dot: '#dc2626' },
  saving: { label: 'Saving…', cls: 'border-amber/40 bg-amber/10 text-amber hover:bg-amber/20', dot: '#f59e0b' },
}

export default function App() {
  const { leads, sync } = useStore()
  const [tab, setTab] = useState('pipeline')
  const [openLeadId, setOpenLeadId] = useState(null)
  const [modalLead, setModalLead] = useState(null) // null = closed, 'new' = add, object = edit
  const [settingsOpen, setSettingsOpen] = useState(false)

  const openLead = leads.find((l) => l.id === openLeadId) || null
  const overdueCount = leads.filter((l) => l.nextFollowUp && l.nextFollowUp < new Date().toISOString().slice(0, 10)).length
  const pill = PILL[sync.status] || PILL.demo
  const showOfflineBanner = sync.status === 'offline'

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wagreen text-sm font-bold text-white">A</span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight">NineToFive</h1>
              <p className="hidden text-[11px] leading-tight text-navy/50 sm:block">Lead &amp; pipeline tracker</p>
            </div>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Connection settings"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${pill.cls}`}
          >
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: pill.dot }} />
            <span className="whitespace-nowrap">{pill.label}</span>
          </button>
          <nav className="order-last flex w-full justify-center gap-1 rounded-xl bg-cream p-1 text-[13px] sm:order-none sm:ml-auto sm:w-auto sm:text-sm">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative whitespace-nowrap rounded-lg px-2.5 py-1.5 font-medium transition-colors sm:px-4 ${
                  tab === t.id ? 'bg-white text-navy shadow-sm' : 'text-navy/60 hover:text-navy'
                }`}
              >
                {t.label}
                {t.id === 'followups' && overdueCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[10px] font-bold text-white">
                    {overdueCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        {showOfflineBanner && (
          <div className="bg-red-50 px-4 py-1.5 text-center text-xs font-medium text-red-700 sm:px-6">
            Offline · showing cached data — changes are kept on this device and the sheet updates when you reconnect.
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'pipeline' && <Board onOpenLead={setOpenLeadId} onNewLead={() => setModalLead('new')} />}
        {tab === 'followups' && <Followups onOpenLead={setOpenLeadId} />}
        {tab === 'analytics' && <Analytics />}
      </main>

      <LeadDrawer
        lead={openLead}
        onClose={() => setOpenLeadId(null)}
        onEdit={(lead) => setModalLead(lead)}
      />
      {modalLead !== null && (
        <LeadModal
          lead={modalLead === 'new' ? null : modalLead}
          onClose={() => setModalLead(null)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {sync.toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
              t.kind === 'error' ? 'bg-terracotta text-white' : t.kind === 'success' ? 'bg-deepgreen text-white' : 'bg-navy text-white'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
