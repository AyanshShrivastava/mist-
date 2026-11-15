import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ModelHealthIncident } from '../utils/aiErrors';

interface VoiceTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface VoiceChatModalProps {
  isOpen: boolean;
  mode: 'create' | 'refine';
  projectName?: string;
  onClose: () => void;
  onApplyPrompt: (synthesizedPrompt: string) => void;
  onIncident?: (incident: ModelHealthIncident) => void;
}

function pcmFloat32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToFloat32Pcm(base64: string): { samples: Float32Array<ArrayBuffer>; rms: number } {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const samples = new Float32Array(new ArrayBuffer(int16.length * 4));
  let sumSq = 0;
  for (let i = 0; i < int16.length; i++) {
    const val = int16[i] / 32768;
    samples[i] = val;
    sumSq += val * val;
  }
  const rms = int16.length > 0 ? Math.sqrt(sumSq / int16.length) : 0;
  return { samples, rms };
}

export default function VoiceChatModal({
  isOpen,
  mode,
  projectName,
  onClose,
  onApplyPrompt,
  onIncident,
}: VoiceChatModalProps) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'closed'>('connecting');
  const [statusNote, setStatusNote] = useState<string>('Connecting to Gemini Live voice...');
  const [incident, setIncident] = useState<ModelHealthIncident | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [textDraft, setTextDraft] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const mutedRef = useRef(false);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef(0);
  const queuedSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const onIncidentRef = useRef(onIncident);

  useEffect(() => {
    onIncidentRef.current = onIncident;
  }, [onIncident]);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const stopQueuedPlayback = useCallback(() => {
    for (const src of queuedSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
    }
    queuedSourcesRef.current = [];
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const cleanupSession = useCallback(() => {
    stopQueuedPlayback();
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      void inputCtxRef.current.close().catch(() => {});
    }
    inputCtxRef.current = null;

    if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
      void outputCtxRef.current.close().catch(() => {});
    }
    outputCtxRef.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setAudioLevel(0);
  }, [stopQueuedPlayback]);

  const appendTurnDelta = useCallback((role: 'user' | 'assistant', delta: string) => {
    const clean = delta;
    if (!clean) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text}${clean}` },
        ];
      }
      return [
        ...prev,
        { id: `${role}-${Date.now()}-${prev.length}`, role, text: clean.trimStart() },
      ];
    });
  }, []);

  const schedulePcmPlayback = useCallback((base64Audio: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx || outCtx.state === 'closed') return;
    const { samples, rms } = base64ToFloat32Pcm(base64Audio);
    if (samples.length === 0) return;

    setAudioLevel(Math.min(1, rms * 4.5));

    const buffer = outCtx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);

    const source = outCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now + 0.015, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    queuedSourcesRef.current.push(source);
    source.onended = () => {
      queuedSourcesRef.current = queuedSourcesRef.current.filter((s) => s !== source);
      if (queuedSourcesRef.current.length === 0) {
        setAudioLevel(0);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cleanupSession();
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    setStatusNote('Connecting to Gemini Live voice...');
    setIncident(null);
    setTurns([]);
    setMicAvailable(true);
    setIsMuted(false);
    mutedRef.current = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/voice/live`);
    wsRef.current = ws;

    const outputCtx = new AudioContext({ sampleRate: 24000 });
    outputCtxRef.current = outputCtx;
    nextStartTimeRef.current = outputCtx.currentTime;

    async function startMicrophone() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicAvailable(false);
        setStatusNote('Microphone unavailable in this browser. Type below to talk with Mist.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const inputCtx = new AudioContext({ sampleRate: 16000 });
        inputCtxRef.current = inputCtx;
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (mutedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
          const channel = event.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < channel.length; i++) {
            sumSq += channel[i] * channel[i];
          }
          const rms = Math.sqrt(sumSq / channel.length);
          if (queuedSourcesRef.current.length === 0) {
            setAudioLevel(Math.min(1, rms * 6));
          }
          const base64 = pcmFloat32ToBase64(channel);
          wsRef.current.send(JSON.stringify({ audio: base64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      } catch {
        if (!cancelled) {
          setMicAvailable(false);
          setStatusNote('Microphone permission blocked. Type below to chat with Mist Voice.');
        }
      }
    }

    ws.onopen = () => {
      if (cancelled) return;
      void startMicrophone();
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          model?: string;
          audio?: string;
          text?: string;
          incident?: ModelHealthIncident;
        };

        if (msg.type === 'ready') {
          setStatus('live');
          setStatusNote(`Live · ${msg.model || 'gemini-3.8-live'}`);
          const contextKickoff =
            mode === 'refine' && projectName
              ? `We are currently refining the "${projectName}" website. Ask me briefly what changes I want.`
              : 'Greet me briefly and ask what kind of website I want to build today.';
          ws.send(JSON.stringify({ text: contextKickoff }));
        } else if (msg.type === 'audio' && msg.audio) {
          if (outputCtxRef.current?.state === 'suspended') {
            void outputCtxRef.current.resume();
          }
          schedulePcmPlayback(msg.audio);
        } else if (msg.type === 'inputTranscript' && msg.text) {
          appendTurnDelta('user', msg.text);
        } else if (msg.type === 'outputTranscript' && msg.text) {
          appendTurnDelta('assistant', msg.text);
        } else if (msg.type === 'interrupted') {
          stopQueuedPlayback();
        } else if (msg.type === 'error' && msg.incident) {
          setStatus('error');
          setIncident(msg.incident);
          setStatusNote(msg.incident.title);
          onIncidentRef.current?.(msg.incident);
        } else if (msg.type === 'closed') {
          setStatus('closed');
          setStatusNote('Voice session ended.');
        }
      } catch {
        // Ignore malformed server events
      }
    };

    ws.onerror = () => {
      if (!cancelled) {
        setStatus('error');
        setStatusNote('Voice connection dropped.');
      }
    };

    return () => {
      cancelled = true;
      cleanupSession();
    };
  }, [
    isOpen,
    mode,
    projectName,
    cleanupSession,
    schedulePcmPlayback,
    appendTurnDelta,
    stopQueuedPlayback,
  ]);

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = textDraft.trim();
    if (!cleaned || wsRef.current?.readyState !== WebSocket.OPEN) return;
    if (outputCtxRef.current?.state === 'suspended') {
      void outputCtxRef.current.resume();
    }
    appendTurnDelta('user', cleaned);
    wsRef.current.send(JSON.stringify({ text: cleaned }));
    setTextDraft('');
  };

  const buildSynthesizedPrompt = () => {
    const userMessages = turns
      .filter((t) => t.role === 'user')
      .map((t) => t.text.trim())
      .filter(Boolean);
    const assistantMessages = turns
      .filter((t) => t.role === 'assistant')
      .map((t) => t.text.trim())
      .filter(Boolean);
    if (userMessages.length > 0) {
      return userMessages.join(' ');
    }
    return assistantMessages.join(' ');
  };

  const canApply = turns.some((t) => t.text.trim().length > 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex w-full sm:max-w-xl max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-3 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800/90">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600/15 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 id="voice-modal-title" className="font-display text-sm font-semibold text-zinc-950 dark:text-white truncate">
                    Mist Voice Studio
                  </h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {statusNote}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close voice chat"
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Incident / Outage Alert */}
            {incident && (
              <div
                role="alert"
                className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{incident.title}</p>
                  <p className="mt-0.5 text-[11px] opacity-90">{incident.message}</p>
                </div>
              </div>
            )}

            {/* Audio Level Waveform + Controls */}
            <div className="mx-5 mt-4 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex items-center gap-1.5 h-8" aria-label="Voice audio activity meter">
                {[0.45, 0.75, 1, 0.85, 0.6, 0.9, 0.5].map((weight, idx) => {
                  const barHeight = Math.max(4, Math.round(4 + audioLevel * 24 * weight));
                  return (
                    <span
                      key={idx}
                      style={{ height: `${barHeight}px` }}
                      className="w-1 rounded-full bg-blue-500 transition-[height] duration-75"
                    />
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                {micAvailable && (
                  <button
                    type="button"
                    onClick={() => setIsMuted((m) => !m)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      isMuted
                        ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
                        : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {isMuted ? (
                      <>
                        <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Muted</span>
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                        <span>Mic On</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
                >
                  <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>End</span>
                </button>
              </div>
            </div>

            {/* Live Transcript Feed */}
            <div className="mx-5 mt-3 h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3.5 space-y-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/40 mist-scrollbar">
              {turns.length === 0 ? (
                <p className="py-16 text-center text-zinc-500 dark:text-zinc-400">
                  Speak naturally or type below to brainstorm sections, style, or layout changes with Mist.
                </p>
              ) : (
                turns.map((turn) => (
                  <div
                    key={turn.id}
                    className={`rounded-lg px-3 py-2 leading-relaxed ${
                      turn.role === 'user'
                        ? 'ml-8 bg-blue-600/10 text-zinc-900 dark:bg-blue-500/15 dark:text-zinc-100'
                        : 'mr-8 border border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
                    }`}
                  >
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {turn.role === 'user' ? 'You' : 'Mist'}
                    </p>
                    <p>{turn.text}</p>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Text Input Fallback & Apply Action */}
            <div className="p-5 space-y-3">
              <form onSubmit={handleSendText} className="flex items-center gap-2">
                <label htmlFor="voice-text-input" className="sr-only">
                  Send text to live voice session
                </label>
                <input
                  id="voice-text-input"
                  type="text"
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  disabled={status !== 'live'}
                  placeholder={status === 'live' ? 'Or type a message into the live voice session...' : 'Waiting for live connection...'}
                  className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <button
                  type="submit"
                  disabled={status !== 'live' || !textDraft.trim()}
                  aria-label="Send message to voice session"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </form>

              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {mode === 'create'
                    ? 'Turn your voice conversation into a complete website.'
                    : 'Send your spoken changes directly to the AI editor.'}
                </span>
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={() => {
                    const summary = buildSynthesizedPrompt();
                    if (summary) {
                      onApplyPrompt(summary);
                      onClose();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>{mode === 'create' ? 'Build from Voice' : 'Apply to Website'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
