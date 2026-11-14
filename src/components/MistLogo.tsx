import React from 'react';

interface MistLogoProps {
  size?: 'sm' | 'md';
  showWordmark?: boolean;
}

export default function MistLogo({ size = 'md', showWordmark = true }: MistLogoProps) {
  const dim = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  const textSize = size === 'sm' ? 'text-base' : 'text-lg';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <span
        className={`${dim} relative inline-flex items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-slate-900 p-[1px] shadow-sm`}
        aria-hidden="true"
      >
        <span className="flex h-full w-full items-center justify-center rounded-[7px] bg-zinc-950/90">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 15.5C6.5 13.5 9.5 13.5 12 15.5C14.5 17.5 17.5 17.5 20 15.5"
              stroke="#60A5FA"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M4 10.5C6.5 8.5 9.5 8.5 12 10.5C14.5 12.5 17.5 12.5 20 10.5"
              stroke="#F4F4F5"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="17.5" cy="6" r="1.5" fill="#93C5FD" />
          </svg>
        </span>
      </span>
      {showWordmark && (
        <span className={`font-display ${textSize} font-bold tracking-tight text-zinc-950 dark:text-white`}>
          Mist
        </span>
      )}
    </span>
  );
}
