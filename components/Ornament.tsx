/** Decorative frames. Lime primary, gold secondary. */

import type { ReactNode } from "react";

export function CornerOrnaments({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
    >
      <svg
        className="absolute left-2 top-2 h-8 w-8 text-lime/55 sm:left-4 sm:top-4 sm:h-12 sm:w-12"
        viewBox="0 0 56 56"
        fill="none"
      >
        <path
          d="M2 20V6a4 4 0 0 1 4-4h14"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path d="M2 12H12V2" stroke="#f5c842" strokeWidth="0.9" opacity="0.8" />
      </svg>
      <svg
        className="absolute right-2 top-2 h-8 w-8 text-lime/55 sm:right-4 sm:top-4 sm:h-12 sm:w-12"
        viewBox="0 0 56 56"
        fill="none"
      >
        <path
          d="M54 20V6a4 4 0 0 0-4-4H36"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path d="M54 12H44V2" stroke="#f5c842" strokeWidth="0.9" opacity="0.8" />
      </svg>
      <svg
        className="absolute bottom-2 left-2 h-8 w-8 text-gold/50 sm:bottom-4 sm:left-4 sm:h-12 sm:w-12"
        viewBox="0 0 56 56"
        fill="none"
      >
        <path
          d="M2 36v14a4 4 0 0 0 4 4h14"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M2 44H12V54"
          stroke="#c8f135"
          strokeWidth="0.9"
          opacity="0.75"
        />
      </svg>
      <svg
        className="absolute bottom-2 right-2 h-8 w-8 text-gold/50 sm:bottom-4 sm:right-4 sm:h-12 sm:w-12"
        viewBox="0 0 56 56"
        fill="none"
      >
        <path
          d="M54 36v14a4 4 0 0 1-4 4H36"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M54 44H44V54"
          stroke="#c8f135"
          strokeWidth="0.9"
          opacity="0.75"
        />
      </svg>
    </div>
  );
}

export function HexSeal({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 120 120" fill="none">
      <defs>
        <linearGradient id="sealGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c8f135" />
          <stop offset="100%" stopColor="#f5c842" />
        </linearGradient>
      </defs>
      <polygon
        points="60,6 108,34 108,86 60,114 12,86 12,34"
        stroke="url(#sealGrad)"
        strokeWidth="1.4"
        opacity="0.85"
      />
      <polygon
        points="60,18 96,40 96,80 60,102 24,80 24,40"
        stroke="#f5c842"
        strokeWidth="0.9"
        opacity="0.45"
      />
      <circle
        cx="60"
        cy="60"
        r="14"
        stroke="#c8f135"
        strokeWidth="0.9"
        opacity="0.6"
      />
      <circle cx="60" cy="60" r="5" fill="#f5c842" opacity="0.95" />
      <path
        d="M60 28v12M60 80v12M28 60h12M80 60h12"
        stroke="#c8f135"
        strokeWidth="0.8"
        opacity="0.55"
      />
    </svg>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="h-px w-5 shrink-0 bg-gradient-to-r from-transparent to-lime sm:w-8" />
      <span className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-lime sm:text-[11px] sm:tracking-[0.26em]">
        {children}
      </span>
      <span className="h-px min-w-[2rem] flex-1 bg-gradient-to-r from-lime to-transparent sm:max-w-[140px]" />
    </div>
  );
}
