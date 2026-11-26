import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiProviderConfig,
  MistUser as User,
  PreviewConsoleEntry,
  PreviewHealthSnapshot,
  SelectedVisualElement,
  VisualElementPatch,
} from '../../types/mist';
import { relayAppAiRequest } from './appAiRelay';
import { useEphemeralPreviewSession } from './useEphemeralPreviewSession';

export function isValidSelectedElement(p: unknown): p is SelectedVisualElement {
  if (!p || typeof p !== 'object') return false;
  const el = p as Partial<SelectedVisualElement>;
  return (
    typeof el.mistId === 'string' &&
    typeof el.tagName === 'string' &&
    typeof el.textContent === 'string' &&
    typeof el.className === 'string' &&
    Boolean(el.styles && typeof el.styles === 'object')
  );
}

interface UseAppAiBridgeParams {
  hasAppAi: boolean;
  providerConfig: AiProviderConfig;
  user: User | null;
  viewMode: string;
  onSelectElement: (el: SelectedVisualElement) => void;
}

function isIframeMessage(event: MessageEvent, targetWindow: Window | null): boolean {
  if (!targetWindow) return false;
  if (event.source !== targetWindow) return false;
  return Boolean(event.data && typeof event.data === 'object');
}

interface MessageContext {
  onSelectElement: (el: SelectedVisualElement) => void;
  onPreviewLog: (entry: PreviewConsoleEntry) => void;
  onPreviewSnapshot: (requestId: string | null, snapshot: PreviewHealthSnapshot) => void;
  user: User | null;
  hasAppAi: boolean;
  providerConfig: AiProviderConfig;
  sessionToken: string | null;
}

function handleIncomingMessage(data: unknown, win: Window, ctx: MessageContext): void {
  const msg = data as { type?: unknown; requestId?: unknown; payload?: unknown };

  if (msg.type === 'MIST_SELECT_ELEMENT' && isValidSelectedElement(msg.payload)) {
    ctx.onSelectElement(msg.payload);
    return;
  }

  if (msg.type === 'MIST_PREVIEW_LOG' && msg.payload && typeof msg.payload === 'object') {
    const p = msg.payload as Partial<PreviewConsoleEntry>;
    const lvl =
      p.level === 'runtime_error' || p.level === 'error' || p.level === 'warn' ? p.level : 'log';
    ctx.onPreviewLog({
      id: `plog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      level: lvl,
      message: String(p.message || ''),
      source: typeof p.source === 'string' ? p.source : undefined,
      line: typeof p.line === 'number' ? p.line : undefined,
      column: typeof p.column === 'number' ? p.column : undefined,
      stack: typeof p.stack === 'string' ? p.stack : undefined,
      timestamp: typeof p.timestamp === 'string' ? p.timestamp : new Date().toISOString(),
    });
    return;
  }

  if (msg.type === 'MIST_PREVIEW_SNAPSHOT' && msg.payload && typeof msg.payload === 'object') {
    const reqId = typeof msg.requestId === 'string' ? msg.requestId : null;
    ctx.onPreviewSnapshot(reqId, msg.payload as PreviewHealthSnapshot);
    return;
  }

  if (msg.type === 'MIST_APP_AI_REQUEST' && typeof msg.requestId === 'string') {
    const payload = msg.payload && typeof msg.payload === 'object'
      ? (msg.payload as Record<string, unknown>)
      : {};
    void relayAppAiRequest({
      reqId: msg.requestId,
      payload,
      user: ctx.user,
      hasAppAi: ctx.hasAppAi,
      providerConfig: ctx.providerConfig,
      sessionToken: ctx.sessionToken,
      targetWindow: win,
    });
  }
}

export function useAppAiBridge({
  hasAppAi,
  providerConfig,
  user,
  viewMode,
  onSelectElement,
}: UseAppAiBridgeParams) {
  const sessionToken = useEphemeralPreviewSession(hasAppAi, providerConfig, user);
  const sessionTokenRef = useRef<string | null>(null);
  sessionTokenRef.current = sessionToken;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [consoleEntries, setConsoleEntries] = useState<PreviewConsoleEntry[]>([]);
  const [latestSnapshot, setLatestSnapshot] = useState<PreviewHealthSnapshot | null>(null);
  const pendingCapturesRef = useRef<Map<string, (snap: PreviewHealthSnapshot | null) => void>>(new Map());

  const clearConsoleEntries = useCallback(() => {
    setConsoleEntries([]);
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const win = iframeRef.current?.contentWindow || null;
      if (!isIframeMessage(event, win) || !win) return;
      handleIncomingMessage(event.data, win, {
        onSelectElement,
        onPreviewLog: (entry) => {
          setConsoleEntries((prev) => [...prev.slice(-79), entry]);
        },
        onPreviewSnapshot: (reqId, snap) => {
          setLatestSnapshot(snap);
          if (reqId) {
            const resolver = pendingCapturesRef.current.get(reqId);
            if (resolver) {
              pendingCapturesRef.current.delete(reqId);
              resolver(snap);
            }
          }
        },
        user,
        hasAppAi,
        providerConfig,
        sessionToken: sessionTokenRef.current,
      });
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [hasAppAi, onSelectElement, providerConfig, user]);

  const syncBridgeToIframe = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: 'MIST_TOGGLE_INSPECTOR', enabled: viewMode === 'visual' }, '*');
      win.postMessage({ type: 'MIST_SET_APP_AI_STATE', payload: { appAiEnabled: hasAppAi } }, '*');
    }
  };

  const handleLivePreviewPatch = (patch: VisualElementPatch) => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: 'MIST_LIVE_PATCH', payload: patch }, '*');
    }
  };

  const capturePreviewSnapshot = useCallback((): Promise<PreviewHealthSnapshot | null> => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return Promise.resolve(null);
    const reqId = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new Promise<PreviewHealthSnapshot | null>((resolve) => {
      const timer = window.setTimeout(() => {
        if (pendingCapturesRef.current.has(reqId)) {
          pendingCapturesRef.current.delete(reqId);
          resolve(null);
        }
      }, 2500);
      pendingCapturesRef.current.set(reqId, (snap) => {
        window.clearTimeout(timer);
        resolve(snap);
      });
      win.postMessage({ type: 'MIST_CAPTURE_PREVIEW', requestId: reqId }, '*');
    });
  }, []);

  return {
    iframeRef,
    sessionToken,
    consoleEntries,
    clearConsoleEntries,
    latestSnapshot,
    capturePreviewSnapshot,
    syncBridgeToIframe,
    handleLivePreviewPatch,
  };
}
