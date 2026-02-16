import RunsList from '@/components/RunsList';
import NewRunForm from '@/components/NewRunForm';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-black border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-xl font-bold text-white">FlowSense</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex flex-col items-center">
          <h2 className="text-2xl font-bold mb-4 text-white text-center">New Analysis</h2>
          <NewRunForm />
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-4 text-white">Recent Analyses</h2>
          <RunsList />
        </div>
      </main>
    </div>
  );
}
