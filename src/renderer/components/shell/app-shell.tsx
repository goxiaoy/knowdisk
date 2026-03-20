import { FilesPanel } from "../files-panel";
import { Card } from "../ui/card";
import { AppSidebar } from "./app-sidebar";
import { ChatPanel } from "./chat-panel";
import { SearchPanel } from "./search-panel";
import type { AppShellProps } from "./types";

export function AppShell({
  route,
  onNavigate,
  modelStatus,
  indexStatus,
  vfsStatus,
  vectorDbStatus,
  filesApi,
  searchApi,
}: AppShellProps) {
  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_80%_-10%,#dbeafe,transparent_35%),radial-gradient(circle_at_0%_100%,#ecfeff,transparent_45%),#f8fafc] text-slate-900">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-none grid-cols-[240px_minmax(0,1fr)] gap-3 px-3 py-3 md:gap-4 md:px-4 md:py-4">
        <AppSidebar
          indexStatus={indexStatus}
          modelStatus={modelStatus}
          onNavigate={onNavigate}
          route={route}
          vfsStatus={vfsStatus}
          vectorDbStatus={vectorDbStatus}
        />

        <Card className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl bg-white/80 p-4 pb-6 shadow-[0_10px_30px_rgba(15,23,42,0.07)] backdrop-blur-sm md:p-6 md:pb-8">
          {route === "/chat" ? <ChatPanel searchApi={searchApi} /> : null}
          <div className={route === "/search" ? "flex min-h-0 flex-1" : "hidden min-h-0 flex-1"}>
            <SearchPanel api={searchApi} />
          </div>
          {route === "/files" ? <FilesPanel api={filesApi} /> : null}
        </Card>
      </div>
    </div>
  );
}

export type { MainRoute } from "./types";
