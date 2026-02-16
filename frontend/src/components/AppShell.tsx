'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideSidebar = pathname === '/login' || pathname.startsWith('/auth');

  return (
    <>
      {!hideSidebar && <Sidebar />}
      <main className={cn('min-h-screen p-8', hideSidebar ? 'ml-0' : 'ml-64')}>
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>
    </>
  );
}
