import { FilesPanel } from "../files-panel";
import { Card } from "../ui/card";
import { AppSidebar } from "./app-sidebar";
import { ChatPanel } from "./chat-panel";
import { SearchPanel } from "./search-panel";
import type { AppShellProps } from "./types";

export function AppShell({ route, onNavigate, modelStatus, vfsStatus, filesApi }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_80%_-10%,#dbeafe,transparent_35%),radial-gradient(circle_at_0%_100%,#ecfeff,transparent_45%),#f8fafc] text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1480px] grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[260px_minmax(0,1fr)] md:gap-6 md:px-6">
        <AppSidebar
          modelStatus={modelStatus}
          onNavigate={onNavigate}
          route={route}
          vfsStatus={vfsStatus}
        />

        <Card className="relative rounded-3xl bg-white/80 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.07)] backdrop-blur-sm md:p-8">
          {route === "/chat" ? <ChatPanel /> : null}
          {route === "/search" ? <SearchPanel /> : null}
          {route === "/files" ? <FilesPanel api={filesApi} /> : null}
        </Card>
      </div>
    </div>
  );
}

export type { MainRoute } from "./types";
