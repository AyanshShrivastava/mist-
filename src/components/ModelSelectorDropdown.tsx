import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AiProviderId } from '../types/mist';
import { PROVIDER_CATALOG } from '../data/models';

interface ModelSelectorDropdownProps {
  provider: AiProviderId;
  value: string;
  onChange: (modelId: string) => void;
  allowCustomInput?: boolean;
  compact?: boolean;
}

export default function ModelSelectorDropdown({
  provider,
  value,
  onChange,
  allowCustomInput = true,
  compact = false,
}: ModelSelectorDropdownProps) {
  const [expanded, setExpanded] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const catalog = PROVIDER_CATALOG[provider];
  const activeEntry = catalog.models.find((m) => m.id === value);

  const filteredModels = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return catalog.models;
    return catalog.models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.tier.toLowerCase().includes(q),
    );
  }, [catalog.models, filterQuery]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white text-left transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 cursor-pointer ${
          compact ? 'px-3 py-2 text-xs' : 'px-3.5 py-2.5 text-xs'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-950 dark:text-white truncate">
              {activeEntry ? activeEntry.label : value}
            </span>
            {activeEntry && (
              <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">
                {activeEntry.tier}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {value}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[11px] font-medium text-zinc-500 dark:text-zinc-400 tabular-nums">
            {catalog.models.length} models
          </span>
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/90 dark:border-zinc-800 dark:bg-zinc-900/80"
          >
            <div className="p-2.5 space-y-2">
              {catalog.models.length > 5 && (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder={`Filter ${catalog.name} models...`}
                    aria-label={`Filter ${catalog.name} models`}
                    className="w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
              )}

              <div
                role="listbox"
                aria-label={`${catalog.name} models`}
                className="max-h-56 overflow-y-auto divide-y divide-zinc-200/70 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800/80 dark:border-zinc-800 dark:bg-zinc-950 mist-scrollbar"
              >
                {filteredModels.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[11px] text-zinc-500">
                    No matching model preset — enter any model ID below.
                  </p>
                ) : (
                  filteredModels.map((item) => {
                    const selected = value === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onChange(item.id);
                          setExpanded(false);
                        }}
                        className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                          selected
                            ? 'bg-blue-50/90 dark:bg-blue-500/10'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`text-xs font-medium ${
                                selected
                                  ? 'text-blue-700 dark:text-blue-300'
                                  : 'text-zinc-900 dark:text-zinc-100'
                              }`}
                            >
                              {item.label}
                            </span>
                            <span className="text-[10px] text-zinc-400">·</span>
                            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                              {item.tier}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                            {item.summary}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                            {item.id}
                          </p>
                        </div>

                        {selected && (
                          <Check
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {allowCustomInput && (
                <div className="pt-1">
                  <label
                    htmlFor={`custom-model-input-${provider}`}
                    className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    Or type any custom {catalog.name} model ID
                  </label>
                  <input
                    id={`custom-model-input-${provider}`}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={catalog.models[0].id}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
