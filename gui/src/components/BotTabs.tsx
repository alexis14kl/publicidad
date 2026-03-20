import type { ReactNode } from 'react'

export type BotTabId = 'image' | 'video'

interface BotTabDef {
  id: BotTabId
  label: string
  icon: string
}

const TABS: BotTabDef[] = [
  { id: 'image', label: 'Publicar Imagen', icon: '\uD83D\uDCF8' },
  { id: 'video', label: 'Publicar Video', icon: '\uD83C\uDFAC' },
]

interface BotTabsProps {
  activeTab: BotTabId
  onChangeTab: (tab: BotTabId) => void
  children: Record<BotTabId, ReactNode>
}

export function BotTabs({ activeTab, onChangeTab, children }: BotTabsProps) {
  return (
    <div className="bot-tabs glass-card">
      <div className="bot-tabs__header" role="tablist" aria-label="Tipo de bot">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`bot-tabs__tab ${activeTab === tab.id ? 'bot-tabs__tab--active' : ''}`}
            onClick={() => onChangeTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            type="button"
          >
            <span className="bot-tabs__icon">{tab.icon}</span>
            <span className="bot-tabs__label">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="bot-tabs__content">
        {children[activeTab]}
      </div>
    </div>
  )
}
