import NewRunForm from '@/components/NewRunForm';

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
          Analyze UX Flows with AI
        </h1>
        <p className="text-zinc-400 text-lg">
          Upload a screen recording and get instant UX insights using local AI
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        <NewRunForm />
      </div>

      <div className="flex items-center justify-center gap-6 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          100% Local
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
          No cloud costs
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
          Private
        </span>
      </div>
    </div>
  );
}
