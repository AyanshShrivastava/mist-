import React, { useEffect, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  MousePointerClick,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { SelectedVisualElement, VisualElementPatch, VisualElementStyles } from '../types/mist';

interface VisualInspectorProps {
  selectedElement: SelectedVisualElement | null;
  onLivePreviewPatch: (patch: VisualElementPatch) => void;
  onCommitPatch: (patch: VisualElementPatch) => void;
  onAskAiAboutElement: (element: SelectedVisualElement) => void;
}

const SWATCHES = ['#09090B', '#FFFFFF', '#4F46E5', '#0D9488', '#D97706', '#E4E4E7'];

function toSafeHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

export default function VisualInspector({
  selectedElement,
  onLivePreviewPatch,
  onCommitPatch,
  onAskAiAboutElement,
}: VisualInspectorProps) {
  const [textDraft, setTextDraft] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [stylesDraft, setStylesDraft] = useState<VisualElementStyles>({
    color: '#09090b',
    backgroundColor: '',
    fontSize: '16px',
    fontWeight: '400',
    paddingTop: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    paddingRight: '0px',
    borderRadius: '0px',
    textAlign: 'left',
  });

  useEffect(() => {
    if (!selectedElement) return;
    setTextDraft(selectedElement.textContent);
    setStylesDraft(selectedElement.styles);
  }, [selectedElement]);

  if (!selectedElement) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-(--mist-c2) dark:border-zinc-800 dark:bg-zinc-900">
          <MousePointerClick className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 className="mt-3.5 font-display text-sm font-semibold text-zinc-950 dark:text-white">
          Visual Inspector
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Click any heading, button, or container inside the preview to edit it live.
        </p>
        <div className="mt-5 w-full space-y-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 text-left text-[11px] text-zinc-600 dark:border-white/[0.06] dark:bg-zinc-900/50 dark:text-zinc-400">
          <p><span className="font-semibold text-zinc-900 dark:text-zinc-200">1. Select</span> any element on canvas</p>
          <p><span className="font-semibold text-zinc-900 dark:text-zinc-200">2. Adjust</span> copy, color, type &amp; spacing</p>
          <p><span className="font-semibold text-zinc-900 dark:text-zinc-200">3. Save</span> directly to source code</p>
        </div>
      </div>
    );
  }

  const updateStyleField = (field: keyof VisualElementStyles, value: string, commit = false) => {
    const nextStyles = { ...stylesDraft, [field]: value };
    setStylesDraft(nextStyles);
    const patch: VisualElementPatch = {
      mistId: selectedElement.mistId,
      styles: { [field]: value },
    };
    onLivePreviewPatch(patch);
    if (commit) {
      onCommitPatch(patch);
    }
  };

  const commitAll = () => {
    onCommitPatch({
      mistId: selectedElement.mistId,
      originalText: selectedElement.textContent,
      newText: selectedElement.canEditText ? textDraft : undefined,
      styles: stylesDraft,
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto mist-scrollbar">
      <div className="border-b border-zinc-200/80 px-4 py-3 dark:border-white/[0.07]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-lg bg-(--mist-c2)/12 px-2 py-0.5 font-mono text-xs font-semibold text-(--mist-c2)">
            &lt;{selectedElement.tagName}&gt;
          </span>
          <span className="font-mono text-[10px] text-zinc-400">
            #{selectedElement.mistId}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-4 text-xs">
        {selectedElement.canEditText && (
          <div>
            <label
              htmlFor="mist-visual-text"
              className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              Content
            </label>
            <textarea
              id="mist-visual-text"
              rows={3}
              value={textDraft}
              onChange={(e) => {
                setTextDraft(e.target.value);
                onLivePreviewPatch({
                  mistId: selectedElement.mistId,
                  newText: e.target.value,
                });
              }}
              onBlur={commitAll}
              className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs text-zinc-950 focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
        )}

        {/* Colors */}
        <div className="space-y-3 border-t border-zinc-200/70 pt-4 dark:border-white/[0.06]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Appearance
          </p>

          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mist-color-text" className="text-zinc-600 dark:text-zinc-300">
              Text Color
            </label>
            <div className="flex items-center gap-2">
              <input
                id="mist-color-text"
                type="color"
                value={toSafeHex(stylesDraft.color, '#09090b')}
                onChange={(e) => updateStyleField('color', e.target.value, true)}
                className="h-6 w-8 cursor-pointer rounded-md border border-zinc-200 bg-transparent p-0 dark:border-zinc-700"
              />
              <span className="w-16 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                {toSafeHex(stylesDraft.color, '#09090b')}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mist-color-bg" className="text-zinc-600 dark:text-zinc-300">
              Background
            </label>
            <div className="flex items-center gap-2">
              <input
                id="mist-color-bg"
                type="color"
                value={toSafeHex(stylesDraft.backgroundColor, '#ffffff')}
                onChange={(e) => updateStyleField('backgroundColor', e.target.value, true)}
                className="h-6 w-8 cursor-pointer rounded-md border border-zinc-200 bg-transparent p-0 dark:border-zinc-700"
              />
              <span className="w-16 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                {stylesDraft.backgroundColor ? toSafeHex(stylesDraft.backgroundColor, '#ffffff') : 'none'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Set background color ${hex}`}
                  onClick={() => updateStyleField('backgroundColor', hex, true)}
                  style={{ backgroundColor: hex }}
                  className="h-5 w-5 rounded-md border border-zinc-300 dark:border-zinc-700 cursor-pointer hover:scale-110 transition-transform"
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => updateStyleField('backgroundColor', 'transparent', true)}
              className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Typography */}
        <div className="space-y-3 border-t border-zinc-200/70 pt-4 dark:border-white/[0.06]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Typography
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="mist-font-size" className="block text-[11px] text-zinc-500">
                Size
              </label>
              <input
                id="mist-font-size"
                type="text"
                value={stylesDraft.fontSize}
                onChange={(e) => updateStyleField('fontSize', e.target.value, false)}
                onBlur={commitAll}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 px-2.5 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label htmlFor="mist-font-weight" className="block text-[11px] text-zinc-500">
                Weight
              </label>
              <select
                id="mist-font-weight"
                value={stylesDraft.fontWeight}
                onChange={(e) => updateStyleField('fontWeight', e.target.value, true)}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900"
              >
                <option value="400">Regular</option>
                <option value="500">Medium</option>
                <option value="600">Semibold</option>
                <option value="700">Bold</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-zinc-600 dark:text-zinc-300">Alignment</span>
            <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
              {(
                [
                  { val: 'left', icon: AlignLeft, label: 'Align left' },
                  { val: 'center', icon: AlignCenter, label: 'Align center' },
                  { val: 'right', icon: AlignRight, label: 'Align right' },
                ] as const
              ).map(({ val, icon: Icon, label }) => (
                <button
                  key={val}
                  type="button"
                  aria-label={label}
                  onClick={() => updateStyleField('textAlign', val, true)}
                  className={`rounded-md p-1.5 cursor-pointer ${
                    stylesDraft.textAlign === val
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-700 dark:text-white'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Spacing & Radius */}
        <div className="space-y-3 border-t border-zinc-200/70 pt-4 dark:border-white/[0.06]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Spacing &amp; Radius
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="mist-pad-y" className="block text-[11px] text-zinc-500">
                Pad Y
              </label>
              <input
                id="mist-pad-y"
                type="text"
                value={stylesDraft.paddingTop}
                onChange={(e) => {
                  const val = e.target.value;
                  setStylesDraft({ ...stylesDraft, paddingTop: val, paddingBottom: val });
                  onLivePreviewPatch({
                    mistId: selectedElement.mistId,
                    styles: { paddingTop: val, paddingBottom: val },
                  });
                }}
                onBlur={commitAll}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 px-2 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label htmlFor="mist-pad-x" className="block text-[11px] text-zinc-500">
                Pad X
              </label>
              <input
                id="mist-pad-x"
                type="text"
                value={stylesDraft.paddingLeft}
                onChange={(e) => {
                  const val = e.target.value;
                  setStylesDraft({ ...stylesDraft, paddingLeft: val, paddingRight: val });
                  onLivePreviewPatch({
                    mistId: selectedElement.mistId,
                    styles: { paddingLeft: val, paddingRight: val },
                  });
                }}
                onBlur={commitAll}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 px-2 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label htmlFor="mist-radius" className="block text-[11px] text-zinc-500">
                Radius
              </label>
              <input
                id="mist-radius"
                type="text"
                value={stylesDraft.borderRadius}
                onChange={(e) => updateStyleField('borderRadius', e.target.value, false)}
                onBlur={commitAll}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50/70 px-2 py-1.5 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 border-t border-zinc-200/70 pt-4 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={commitAll}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl mist-primary-gradient px-3 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            {savedFlash ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Saved to Code</span>
              </>
            ) : (
              <span>Save Visual Changes</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onAskAiAboutElement(selectedElement)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
            <span>Refine with AI</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onLivePreviewPatch({ mistId: selectedElement.mistId, deleted: true });
              onCommitPatch({ mistId: selectedElement.mistId, deleted: true });
            }}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200/90 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Hide Element</span>
          </button>
        </div>
      </div>
    </div>
  );
}
