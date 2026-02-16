import ReportView from '@/components/ReportView';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <Link
        href="/history"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to History
      </Link>

      <ReportView runId={id} />
    </div>
  );
}
