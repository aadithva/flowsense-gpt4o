import { Settings, Cpu, Database, Palette } from 'lucide-react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-zinc-400">
          Configure your FlowSense experience
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Cpu className="w-5 h-5 text-cyan-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">AI Model</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Model:</span>
              <span className="text-white font-mono">llama3.2-vision:11b</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Status:</span>
              <span className="flex items-center gap-1.5 text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Running
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Endpoint:</span>
              <span className="text-white font-mono">localhost:11434</span>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Database className="w-5 h-5 text-blue-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Database</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Provider:</span>
              <span className="text-white">Supabase</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Status:</span>
              <span className="flex items-center gap-1.5 text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Connected
              </span>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-zinc-100/40 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Palette className="w-5 h-5 text-purple-400" />
            </div>
            <h2 className="text-lg font-semibold">Appearance</h2>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-500">
              Choose your preferred theme or sync with your system preference.
            </p>
            <ThemeSwitcher />
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 opacity-50">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/10">
              <Settings className="w-5 h-5 text-green-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Advanced</h2>
          </div>
          <p className="text-sm text-zinc-500">Coming soon...</p>
        </div>
      </div>
    </div>
  );
}
