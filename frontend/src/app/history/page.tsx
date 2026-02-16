import RunsList from '@/components/RunsList';

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Analysis History</h1>
        <p className="text-zinc-400">
          View and manage your past UX analyses
        </p>
      </div>

      <RunsList />
    </div>
  );
}
