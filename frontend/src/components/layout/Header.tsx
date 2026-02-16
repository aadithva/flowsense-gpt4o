'use client';

import Link from 'next/link';
import { Activity, Cpu, Github } from 'lucide-react';

export default function Header() {
  return (
    <header className="border-b border-zinc-800 bg-black/70 backdrop-blur-xl sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800">
            <Activity className="h-5 w-5 text-cyan-400" />
            <span className="absolute inset-0 rounded-xl bg-cyan-400/15 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-50">FlowSense</span>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] font-mono text-zinc-500">
            BETA
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 text-xs text-zinc-500 md:flex">
            <Cpu className="h-4 w-4" />
            <span className="font-mono">Llama 3.2 Vision</span>
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>
          <a
            href="https://github.com/yourusername/flowsense"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 transition-colors hover:text-white"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
