'use client';

import { Activity, Plus, History, Settings, Cpu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    {
      href: '/',
      label: 'New Analysis',
      icon: Plus,
      description: 'Upload & analyze',
    },
    {
      href: '/history',
      label: 'History',
      icon: History,
      description: 'Past analyses',
    },
    {
      href: '/settings',
      label: 'Settings',
      icon: Settings,
      description: 'Configure',
    },
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-background border-r border-border flex flex-col z-40">
      {/* Logo */}
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="relative">
            <Activity className="w-7 h-7 text-primary" />
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full group-hover:bg-primary/30 transition-all" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-foreground block">
              FlowSense
            </span>
          </div>
        </Link>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                    active
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-transparent"
                  )}
                >
                  <Icon className={cn(
                    "w-5 h-5 transition-transform group-hover:scale-110",
                    active && "text-primary"
                  )} />
                  <div className="flex-1">
                    <div className={cn(
                      "text-sm font-medium",
                      active ? "text-primary" : "text-zinc-300"
                    )}>
                      {item.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{item.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <Separator />

      {/* Footer - Ollama Status */}
      <div className="p-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
          <Cpu className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs font-medium text-zinc-400">
              Ollama Local
            </div>
            <div className="text-xs text-muted-foreground">
              llama3.2-vision
            </div>
          </div>
          <Badge variant="outline" className="h-2 w-2 p-0 rounded-full bg-emerald-500 border-0 animate-pulse" />
        </div>
      </div>
    </aside>
  );
}
