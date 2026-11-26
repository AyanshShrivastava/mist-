import React, { useMemo, useState } from 'react';
import { FileCode2, FolderTree, Plus, Trash2 } from 'lucide-react';
import type { MistProject } from '../../types/mist';

interface WorkspaceFileDrawerProps {
  project: MistProject;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
}

export default function WorkspaceFileDrawer({
  project,
  activeFilePath,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
}: WorkspaceFileDrawerProps) {
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const sortedFiles = useMemo(() => {
    const priority = (path: string) => {
      if (path === 'src/App.tsx') return 0;
      if (path === 'src/index.css') return 1;
      if (path.startsWith('src/components/')) return 2;
      return 3;
    };
    return [...project.files].sort((a, b) => {
      const diff = priority(a.path) - priority(b.path);
      return diff !== 0 ? diff : a.path.localeCompare(b.path);
    });
  }, [project.files]);

  const handleAddFile = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFilePath.trim().replace(/^\/+/, '');
    if (!cleaned || !cleaned.includes('.')) {
      setNewFileError('Enter a valid path such as src/components/Footer.tsx');
      return;
    }
    if (project.files.some((f) => f.path === cleaned)) {
      setNewFileError('A file with that path already exists.');
      return;
    }
    setNewFileError(null);
    onCreateFile(cleaned);
    onSelectFile(cleaned);
    setNewFilePath('');
    setShowNewFileInput(false);
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-between border-b border-zinc-200/70 px-3.5 py-2.5 dark:border-white/[0.06]">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          <FolderTree className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
          <span>Source Tree</span>
        </span>
        <button
          type="button"
          onClick={() => setShowNewFileInput((v) => !v)}
          aria-label="Create new source file"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-(--mist-c2) hover:bg-(--mist-c2)/10 cursor-pointer"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          <span>New File</span>
        </button>
      </div>

      {showNewFileInput && (
        <form
          onSubmit={handleAddFile}
          className="border-b border-zinc-200 bg-zinc-50/90 p-3 space-y-2 dark:border-zinc-800 dark:bg-zinc-900/70"
        >
          <input
            type="text"
            aria-label="New file path"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            placeholder="src/components/Footer.tsx"
            className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950 focus:outline-none"
          />
          {newFileError && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{newFileError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewFileInput(false)}
              className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg mist-primary-gradient px-3 py-1 text-[11px] font-semibold text-white cursor-pointer"
            >
              Create
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 mist-scrollbar">
        {sortedFiles.map((file) => {
          const isActive = file.path === activeFilePath;
          const canDelete = file.path !== 'src/App.tsx' && file.path !== 'src/index.css';
          const isConfirming = confirmDeletePath === file.path;
          return (
            <div
              key={file.id}
              className={`group flex items-center justify-between rounded-xl px-2.5 py-2 text-xs font-mono transition-colors ${
                isActive
                  ? 'bg-(--mist-c2)/12 text-(--mist-c2) font-semibold'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.05]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectFile(file.path)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-75" aria-hidden="true" />
                <span className="truncate">{file.path}</span>
              </button>
              {canDelete &&
                (isConfirming ? (
                  <div className="flex items-center gap-1 shrink-0 font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeletePath(null);
                        onDeleteFile(file.path);
                      }}
                      className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                    >
                      Del
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeletePath(null)}
                      className="rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${file.path}`}
                    onClick={() => setConfirmDeletePath(file.path)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600 transition-opacity p-1 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
