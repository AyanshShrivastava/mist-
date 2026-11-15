import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AiProviderId, ModelBilling } from '../types/mist';
import { PROVIDER_CATALOG, type ModelCatalogItem } from '../data/models';

interface ModelSelectorDropdownProps {
  provider: AiProviderId;
  value: string;
  onChange: (modelId: string) => void;
  modelsOverride?: ModelCatalogItem[];
  gatewayLabel?: string;
  allowCustomInput?: boolean;
  compact?: boolean;
}

function BillingBadge({ billing, label }: { billing: ModelBilling; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap shrink-0 ${
        billing === 'free'
          ? 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-500/25'
          : 'bg-amber-500/12 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border border-amber-500/25'
      }`}
    >
      {label}
    </span>
  );
}

export default function ModelSelectorDropdown({
  provider,
  value,
  onChange,
  modelsOverride,
  gatewayLabel,
  allowCustomInput = true,
  compact = false,
}: ModelSelectorDropdownProps) {
  const [expanded, setExpanded] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [billingFilter, setBillingFilter] = useState<'all' | 'free' | 'paid'>('all');

  const catalog = PROVIDER_CATALOG[provider];
  const modelsList = modelsOverride && modelsOverride.length > 0 ? modelsOverride : catalog.models;
  const displayGroupName = gatewayLabel || catalog.name;
  const activeEntry = modelsList.find((m) => m.id === value);

  const freeCount = useMemo(
    () => modelsList.filter((m) => m.billing === 'free').length,
    [modelsList],
  );
  const paidCount = useMemo(
    () => modelsList.filter((m) => m.billing === 'paid').length,
    [modelsList],
  );

  const filteredModels = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return modelsList.filter((m) => {
      if (billingFilter !== 'all' && m.billing !== billingFilter) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.tier.toLowerCase().includes(q) ||
        m.billingLabel.toLowerCase().includes(q)
      );
    });
  }, [modelsList, billingFilter, filterQuery]);

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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-zinc-950 dark:text-white truncate">
              {activeEntry ? activeEntry.label : value}
            </span>
            {activeEntry ? (
              <>
                <BillingBadge billing={activeEntry.billing} label={activeEntry.billingLabel} />
                <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">
                  {activeEntry.tier}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center rounded-md border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                Custom ID
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
            {value}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[11px] font-medium text-zinc-500 dark:text-zinc-400 tabular-nums">
            {modelsList.length} models
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
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder={`Search ${displayGroupName} models (e.g. nemotron, free)...`}
                    aria-label={`Filter ${displayGroupName} models`}
                    className="w-full min-h-[34px] rounded-lg border border-zinc-200 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>

                <div
                  role="group"
                  aria-label="Filter by pricing"
                  className="grid grid-cols-3 sm:flex items-center gap-1 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-950"
                >
                  {(
                    [
                      { id: 'all', label: `All (${modelsList.length})` },
                      { id: 'free', label: `Free (${freeCount})` },
                      { id: 'paid', label: `Paid (${paidCount})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setBillingFilter(f.id)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        billingFilter === f.id
                          ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                          : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                role="listbox"
                aria-label={`${displayGroupName} models`}
                className="max-h-60 overflow-y-auto divide-y divide-zinc-200/70 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800/80 dark:border-zinc-800 dark:bg-zinc-950 mist-scrollbar"
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
                            <BillingBadge billing={item.billing} label={item.billingLabel} />
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
                    Or type any custom {displayGroupName} model ID
                  </label>
                  <input
                    id={`custom-model-input-${provider}`}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={modelsList[0]?.id || 'model-id'}
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
