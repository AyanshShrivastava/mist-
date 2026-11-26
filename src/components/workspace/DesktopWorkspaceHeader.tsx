import React, { useState } from 'react';
import {
  ArrowLeft,
  Code2,
  Columns2,
  Eye,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { MistProject, MistUser as User, ViewportSize, WorkspaceViewMode } from '../../types/mist';
import MistLogo from '../MistLogo';
import DesktopHeaderActions from './DesktopHeaderActions';

interface DesktopWorkspaceHeaderProps {
  user: User | null;
  project: MistProject;
  viewMode: WorkspaceViewMode;
  viewport: ViewportSize;
  shortProviderLabel: string;
  providerApiKey?: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onBackHome: () => void;
  onUpdateProjectName: (name: string) => void;
  onSetViewMode: (mode: WorkspaceViewMode) => void;
  onSetViewport: (viewport: ViewportSize) => void;
  onOpenVoiceChat: () => void;
  onOpenProviders: () => void;
  onDuplicateProject: () => void;
  onExportZip: () => void;
  onOpenDeploy: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

const VIEW_MODES = [
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'visual', label: 'Visual', icon: MousePointerClick },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'split', label: 'Split', icon: Columns2 },
] as const;

export default function DesktopWorkspaceHeader({
  user,
  project,
  viewMode,
  viewport,
  shortProviderLabel,
  providerApiKey,
  sidebarCollapsed,
  onToggleSidebar,
  onBackHome,
  onUpdateProjectName,
  onSetViewMode,
  onSetViewport,
  onOpenVoiceChat,
  onOpenProviders,
  onDuplicateProject,
  onExportZip,
  onOpenDeploy,
  onOpenSettings,
  onOpenAccount,
}: DesktopWorkspaceHeaderProps) {
  const [titleSavedToast, setTitleSavedToast] = useState(false);

  return (
    <header className="hidden lg:flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-200/80 bg-white/95 px-3.5 backdrop-blur-md dark:border-white/[0.08] dark:bg-[#0e0e12]/95">
      {/* Left Navigation + Project Title */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <button
          type="button"
          onClick={onBackHome}
          aria-label="Back to Studio"
          title="Back to Studio"
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-zinc-50/80 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <MistLogo size="xs" showWordmark={false} />
        </button>

        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show AI & Files sidebar' : 'Hide AI & Files sidebar'}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50/80 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white shrink-0 cursor-pointer"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>

        <span className="text-zinc-300 dark:text-zinc-700 shrink-0">/</span>

        <input
          type="text"
          aria-label="Project name"
          value={project.name}
          onChange={(e) => onUpdateProjectName(e.target.value)}
          onBlur={() => {
            setTitleSavedToast(true);
            window.setTimeout(() => setTitleSavedToast(false), 1200);
          }}
          className="min-w-[80px] max-w-[180px] xl:max-w-[240px] flex-1 truncate rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-xs xl:text-sm font-semibold text-zinc-950 hover:border-zinc-200 focus:border-(--mist-c2) focus:bg-white focus:outline-none dark:text-white dark:hover:border-zinc-700 dark:focus:bg-zinc-900"
        />

        {titleSavedToast && (
          <span className="hidden xl:inline text-[11px] font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
            Saved
          </span>
        )}
      </div>

      {/* Center View Mode Switcher */}
      <div
        role="tablist"
        aria-label="Workspace view mode"
        className="flex shrink-0 items-center gap-0.5 rounded-xl border border-zinc-200/80 bg-zinc-100/90 p-1 dark:border-white/[0.06] dark:bg-zinc-900/90"
      >
        {VIEW_MODES.map(({ id, label, icon: Icon }) => {
          const active = viewMode === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              aria-label={label}
              type="button"
              onClick={() => onSetViewMode(id)}
              className={`relative inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'text-zinc-950 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="mist-workspace-mode-pill"
                  transition={{ type: 'spring', bounce: 0.16, duration: 0.3 }}
                  className="absolute inset-0 rounded-lg bg-white shadow-xs dark:bg-zinc-800"
                />
              )}
              <Icon className="relative z-10 h-3.5 w-3.5" aria-hidden="true" />
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </div>

      <DesktopHeaderActions
        user={user}
        viewMode={viewMode}
        viewport={viewport}
        shortProviderLabel={shortProviderLabel}
        providerApiKey={providerApiKey}
        onSetViewport={onSetViewport}
        onOpenVoiceChat={onOpenVoiceChat}
        onOpenProviders={onOpenProviders}
        onDuplicateProject={onDuplicateProject}
        onExportZip={onExportZip}
        onOpenDeploy={onOpenDeploy}
        onOpenSettings={onOpenSettings}
        onOpenAccount={onOpenAccount}
      />
    </header>
  );
}
