import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { McpApprovalRequest } from '../types/mist';

interface McpApprovalModalProps {
  request: McpApprovalRequest | null;
  onDecide: (approvalId: string, approved: boolean) => void;
}

export default function McpApprovalModal({ request, onDecide }: McpApprovalModalProps) {
  return (
    <AnimatePresence>
      {request && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mcp-approval-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="w-full max-w-lg rounded-2xl border border-amber-300/60 bg-white p-5 shadow-2xl dark:border-amber-700/50 dark:bg-[#111115]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id="mcp-approval-title"
                  className="font-display text-sm font-semibold text-zinc-950 dark:text-white"
                >
                  Approve External MCP Action
                </h3>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Mist AI Agent is requesting permission to run a sensitive tool on{' '}
                  <span className="font-semibold text-zinc-900 dark:text-white">
                    {request.serverName}
                  </span>.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Tool &amp; Permission Boundary
                </p>
                <p className="mt-1 font-mono text-xs font-semibold text-zinc-950 dark:text-white">
                  {request.toolName}
                </p>
                <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                  {request.reason}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                  Arguments
                </p>
                <pre className="max-h-44 overflow-auto font-mono text-[11px] text-zinc-800 dark:text-zinc-200 mist-scrollbar">
                  {JSON.stringify(request.arguments || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => onDecide(request.approvalId, false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Decline</span>
              </button>
              <button
                type="button"
                onClick={() => onDecide(request.approvalId, true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl mist-primary-gradient px-4 text-xs font-semibold text-white shadow-sm cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Approve &amp; Execute</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
