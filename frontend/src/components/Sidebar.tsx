'use client';

import { Activity, Plus, History, Settings, Cpu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

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
    <aside className="fixed left-0 top-0 h-screen w-64 bg-black border-r border-zinc-800 flex flex-col z-40">
      {/* Logo */}
      <div className="p-6 border-b border-zinc-800">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="relative">
            <Activity className="w-7 h-7 text-cyan-400" />
            <div className="absolute inset-0 bg-cyan-400/20 blur-xl rounded-full group-hover:bg-cyan-400/30 transition-all" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-white block">
              FlowSense
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                active
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900/50 border border-transparent"
              )}
            >
              <Icon className={cn(
                "w-5 h-5 transition-transform group-hover:scale-110",
                active && "text-cyan-400"
              )} />
              <div className="flex-1">
                <div className={cn(
                  "text-sm font-medium",
                  active ? "text-cyan-400" : "text-zinc-300"
                )}>
                  {item.label}
                </div>
                <div className="text-xs text-zinc-600">
                  {item.description}
                </div>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer - Ollama Status */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/50">
          <Cpu className="w-4 h-4 text-zinc-500" />
          <div className="flex-1">
            <div className="text-xs font-medium text-zinc-400">
              Ollama Local
            </div>
            <div className="text-xs text-zinc-600">
              llama3.2-vision
            </div>
          </div>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        </div>
      </div>
    </aside>
  );
}
