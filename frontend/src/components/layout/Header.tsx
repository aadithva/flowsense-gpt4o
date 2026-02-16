'use client';

import Link from 'next/link';
import { Activity, Cpu, Github } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function Header() {
  return (
    <header className="border-b border-border bg-background/70 backdrop-blur-xl sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-secondary border border-border">
            <Activity className="h-5 w-5 text-primary" />
            <span className="absolute inset-0 rounded-xl bg-primary/15 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">FlowSense</span>
          <Badge variant="outline" className="text-[10px] font-mono">
            BETA
          </Badge>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <Cpu className="h-4 w-4" />
            <span className="font-mono">Llama 3.2 Vision</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <Button variant="outline" size="icon" asChild>
            <a
              href="https://github.com/yourusername/flowsense"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
