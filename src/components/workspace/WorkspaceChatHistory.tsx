import React, { useEffect, useRef } from 'react';
import { FileCode2, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import type { AiStreamProgress, MistProject } from '../../types/mist';
import SearchSourcesCard from '../SearchSourcesCard';
import WorkspaceStreamCard from './WorkspaceStreamCard';

interface WorkspaceChatHistoryProps {
  project: MistProject;
  isRefining: boolean;
  streamProgress: AiStreamProgress | null;
  refineElapsed: number;
  onOpenFile?: (path: string) => void;
  onCancelRefine: () => void;
}

export default function WorkspaceChatHistory({
  project,
  isRefining,
  streamProgress,
  refineElapsed,
  onOpenFile,
  onCancelRefine,
}: WorkspaceChatHistoryProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [project.chatHistory.length, isRefining]);

  return (
    <div className="flex-1 overflow-y-auto p-3.5 space-y-3 mist-scrollbar">
      {project.chatHistory.length === 0 && !isRefining ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 p-5 text-center dark:border-zinc-800">
          <Sparkles className="mx-auto h-5 w-5 text-(--mist-c2)" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-zinc-900 dark:text-white">
            Ask Mist to refine this app
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Describe layout changes, new sections, color palettes, or click an element in Visual mode.
          </p>
        </div>
      ) : (
        project.chatHistory.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={`rounded-2xl p-3 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-zinc-100/90 text-zinc-950 dark:bg-zinc-800/80 dark:text-zinc-100'
                : 'border border-zinc-200/90 bg-white text-zinc-700 dark:border-white/[0.07] dark:bg-zinc-900/70 dark:text-zinc-300'
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">
              {msg.role === 'user' ? 'You' : 'Mist'}
            </p>
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            {msg.role === 'assistant' && msg.toolActivities && msg.toolActivities.length > 0 && (
              <div className="mt-2 space-y-1 rounded-lg border border-zinc-200/80 bg-zinc-50/80 p-2 dark:border-zinc-800 dark:bg-zinc-950/50">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Agent Tools ({msg.toolActivities.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {msg.toolActivities.slice(0, 12).map((act) => (
                    <span
                      key={act.id}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] ${
                        act.status === 'error'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      <span>{act.toolName}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {msg.role === 'assistant' && msg.searchOutcome && (
              <SearchSourcesCard outcome={msg.searchOutcome} compact />
            )}
            {msg.changedFiles && msg.changedFiles.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {msg.changedFiles.map((filePath) => (
                  <button
                    key={filePath}
                    type="button"
                    onClick={() => onOpenFile?.(filePath)}
                    className="inline-flex items-center gap-1 rounded-md border border-(--mist-c2)/30 bg-(--mist-c2)/10 px-2 py-0.5 font-mono text-[10px] font-medium text-(--mist-c2) hover:bg-(--mist-c2)/20 transition-colors cursor-pointer"
                  >
                    <FileCode2 className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                    <span>{filePath}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        ))
      )}

      {isRefining && streamProgress && (
        <WorkspaceStreamCard
          streamProgress={streamProgress}
          refineElapsed={refineElapsed}
          onCancelRefine={onCancelRefine}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
