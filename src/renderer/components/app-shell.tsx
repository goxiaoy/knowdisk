import { HardDriveDownload, Layers3, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const placeholders = [
  {
    icon: HardDriveDownload,
    title: "Package Integrations",
    description: "Core, model, indexing, parser, and vfs will be connected next.",
  },
  {
    icon: Workflow,
    title: "Desktop Workflows",
    description: "The new host shell is ready for commands, settings, and job surfaces.",
  },
  {
    icon: Layers3,
    title: "UI Foundation",
    description: "shadcn/ui primitives now define the renderer structure and styling.",
  },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#182033,transparent_45%),linear-gradient(180deg,#0b1020_0%,#0f172a_45%,#111827_100%)] text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-8 md:px-10">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <Badge className="w-fit">Electrobun Host Reset</Badge>
            <div className="space-y-2">
              <h1 data-testid="app-title" className="text-4xl font-semibold tracking-tight">
                KnowDisk
              </h1>
              <p className="max-w-2xl text-sm text-slate-300 md:text-base">
                A clean desktop shell rebuilt on Electrobun and shadcn/ui. Package services stay
                independent until they are wired back in.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline">View Packages</Button>
            <Button>Connect Next</Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="border-white/10 bg-white/5 text-slate-50">
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription className="text-slate-300">
                The host app is intentionally minimal during the rebuild.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">New renderer</div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                New main process
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                `packages/*` untouched
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {placeholders.map(({ icon: Icon, title, description }) => (
              <Card
                key={title}
                data-testid="status-card"
                className="border-white/10 bg-white/5 text-slate-50"
              >
                <CardHeader className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="space-y-2">
                    <CardTitle>{title}</CardTitle>
                    <CardDescription className="text-slate-300">{description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
