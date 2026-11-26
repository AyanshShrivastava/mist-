import './instrument.ts';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App.tsx';
import MistLogo from './components/MistLogo.tsx';
import { mistClerkAppearance } from './utils/clerkTheme.ts';
import './index.css';

const clerkPublishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  (typeof window !== 'undefined' ? localStorage.getItem('mist_clerk_pub_key') : null);

function ClerkConfigurationError() {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSave = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('pk_test_') && !trimmed.startsWith('pk_live_')) {
      setError('Key must start with pk_test_ or pk_live_');
      return;
    }
    localStorage.setItem('mist_clerk_pub_key', trimmed);
    window.location.reload();
  };

  return (
    <main className="mist-ambient-canvas mist-hero-aurora flex min-h-screen items-center justify-center px-6 py-12">
      <div className="mist-surface-card w-full max-w-md rounded-2xl p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3 mb-5">
          <MistLogo size="md" />
          <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Setup
          </span>
        </div>

        <h1 className="font-display text-lg font-semibold tracking-tight text-zinc-950 dark:text-white">
          Connect authentication to launch Mist
        </h1>
        <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Provide your Clerk Publishable Key (<code className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</code>) or launch immediately with local development defaults.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave(keyInput);
          }}
          className="mt-5 space-y-3.5"
        >
          <div>
            <label
              htmlFor="mist-clerk-pub-key"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Clerk Publishable Key
            </label>
            <input
              id="mist-clerk-pub-key"
              type="text"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setError(null);
              }}
              placeholder="pk_test_... or pk_live_..."
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500 font-mono"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 font-medium">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="submit"
              disabled={!keyInput.trim()}
              className="w-full min-h-[42px] rounded-xl mist-primary-gradient px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-45 cursor-pointer"
            >
              Save Key &amp; Launch Mist
            </button>
            <button
              type="button"
              onClick={() => handleSave('pk_test_Y2xlcmsuaW5zcGlyZWQucHVtYS03NC5sY2wuZGV2JA')}
              className="w-full min-h-[40px] rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Launch with Development Key
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);

if (!clerkPublishableKey) {
  root.render(<ClerkConfigurationError />);
} else {
  root.render(
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      afterSignOutUrl="/"
      appearance={mistClerkAppearance}
    >
      <App />
    </ClerkProvider>,
  );
}
