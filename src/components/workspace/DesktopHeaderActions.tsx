import React, { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Cpu,
  Download,
  Globe,
  Mic,
  Monitor,
  MoreHorizontal,
  Settings,
  Smartphone,
  Tablet,
  User as UserIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { MistUser as User, ViewportSize, WorkspaceViewMode } from '../../types/mist';
import { maskApiKey } from '../../utils/projectOps';

interface DesktopHeaderActionsProps {
  user: User | null;
  viewMode: WorkspaceViewMode;
  viewport: ViewportSize;
  shortProviderLabel: string;
  providerApiKey?: string;
  onSetViewport: (viewport: ViewportSize) => void;
  onOpenVoiceChat: () => void;
  onOpenProviders: () => void;
  onDuplicateProject: () => void;
  onExportZip: () => void;
  onOpenDeploy: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

const VIEWPORTS = [
  { id: 'desktop', icon: Monitor, label: 'Desktop viewport' },
  { id: 'tablet', icon: Tablet, label: 'Tablet viewport' },
  { id: 'mobile', icon: Smartphone, label: 'Mobile viewport' },
] as const;

export default function DesktopHeaderActions({
  user,
  viewMode,
  viewport,
  shortProviderLabel,
  providerApiKey,
  onSetViewport,
  onOpenVoiceChat,
  onOpenProviders,
  onDuplicateProject,
  onExportZip,
  onOpenDeploy,
  onOpenSettings,
  onOpenAccount,
}: DesktopHeaderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const hasKey = Boolean(providerApiKey?.trim());
  const providerTooltip = maskApiKey(providerApiKey)
    ? `Active Key: ${maskApiKey(providerApiKey)}`
    : 'Configure BYOK API key';

  return (
    <div className="flex flex-1 items-center justify-end gap-1.5 shrink-0">
      {viewMode !== 'code' && (
        <div className="hidden xl:flex items-center gap-0.5 rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/70">
          {VIEWPORTS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onSetViewport(id)}
              className={`rounded-lg p-1.5 transition-colors cursor-pointer ${
                viewport === id
                  ? 'bg-zinc-900 text-white shadow-xs dark:bg-white dark:text-zinc-950'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenVoiceChat}
        aria-label="Open Voice Studio"
        title="Voice Studio"
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-zinc-50/80 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Mic className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
        <span className="hidden xl:inline">Voice</span>
      </button>

      <button
        type="button"
        onClick={onOpenProviders}
        aria-label="Configure AI models"
        title={providerTooltip}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-zinc-50/80 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${hasKey ? 'bg-emerald-500' : 'bg-amber-500'}`}
          aria-hidden="true"
        />
        <Cpu className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
        <span className="max-w-[84px] truncate">{shortProviderLabel}</span>
      </button>

      <button
        type="button"
        onClick={onOpenDeploy}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl mist-primary-gradient px-3 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Publish</span>
      </button>

      {/* Overflow Menu: Export ZIP, Duplicate, Settings */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="More workspace actions"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50/80 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 top-full mt-2 z-40 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-[#141418]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onExportZip();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                <span>Export ZIP</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicateProject();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                <span>Duplicate project</span>
              </button>
              <div className="my-1 border-t border-zinc-100 dark:border-white/[0.06]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                <span>Studio Settings</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={onOpenAccount}
        aria-label="Account profile"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-zinc-900/15 hover:ring-zinc-900/35 dark:ring-white/15 dark:hover:ring-white/40 transition shrink-0 cursor-pointer overflow-hidden"
      >
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || 'Account'}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <UserIcon className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
