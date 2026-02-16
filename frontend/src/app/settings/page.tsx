import { Settings, Cpu, Database, Palette } from 'lucide-react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Configure your FlowSense experience
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Cpu className="w-5 h-5 text-primary" />
            </div>
            <CardTitle>AI Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model:</span>
              <span className="text-foreground font-mono">llama3.2-vision:11b</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status:</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Badge variant="outline" className="h-1.5 w-1.5 p-0 rounded-full bg-emerald-500 border-0" />
                Running
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Endpoint:</span>
              <span className="text-foreground font-mono">localhost:11434</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Database className="w-5 h-5 text-blue-400" />
            </div>
            <CardTitle>Database</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider:</span>
              <span className="text-foreground">Supabase</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status:</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Badge variant="outline" className="h-1.5 w-1.5 p-0 rounded-full bg-emerald-500 border-0" />
                Connected
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Palette className="w-5 h-5 text-purple-400" />
            </div>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose your preferred theme or sync with your system preference.
            </p>
            <ThemeSwitcher />
          </CardContent>
        </Card>

        <Card className="opacity-50">
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Settings className="w-5 h-5 text-emerald-400" />
            </div>
            <CardTitle>Advanced</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon...</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
