import { Folder, MessageCircle, Search, SlidersHorizontal } from "lucide-react";
import type { RendererIndexStatus } from "../../../shared/index-status";
import type { RendererModelStatus } from "../../../shared/model-status";
import type { RendererVectorDbStatus } from "../../../shared/vector-db-status";
import type { RendererVfsStatus } from "../../../shared/vfs-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IndexStatusIndicator } from "./index-status-indicator";
import { SidebarNavItem } from "./sidebar-nav-item";
import { StatusIndicator } from "./status-indicator";
import { VectorDbStatusIndicator } from "./vector-db-status-indicator";
import { VfsStatusIndicator } from "./vfs-status-indicator";
import type { MainRoute } from "./types";

const primaryItems = [
  { label: "Chat", route: "/chat" as const, icon: MessageCircle },
  { label: "Search", route: "/search" as const, icon: Search },
];

export function AppSidebar({
  route,
  onNavigate,
  modelStatus,
  indexStatus,
  vfsStatus,
  vectorDbStatus,
}: {
  route: MainRoute;
  onNavigate: (route: MainRoute) => void;
  modelStatus: RendererModelStatus;
  indexStatus: RendererIndexStatus;
  vfsStatus: RendererVfsStatus;
  vectorDbStatus: RendererVectorDbStatus;
}) {
  return (
    <aside
      className="z-10 flex h-full min-h-0 flex-col overflow-visible rounded-[28px] p-3 md:p-4"
      data-testid="app-sidebar"
    >
      <div className="app-drag electrobun-webkit-app-region-drag flex items-start justify-between pb-3">
        <div>
          <p className="text-lg font-semibold text-slate-900">KnowDisk</p>
          <p className="text-xs text-slate-500">Desktop workspace</p>
        </div>
        <Button className="app-no-drag rounded-xl" size="icon" variant="ghost" type="button">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1 pb-3" data-testid="app-sidebar-primary">
        {primaryItems.map(({ icon, label, route: itemRoute }) => (
          <SidebarNavItem
            key={itemRoute}
            active={route === itemRoute}
            icon={icon}
            label={label}
            onClick={() => onNavigate(itemRoute)}
          />
        ))}
      </div>

      <div
        className="mt-3 min-h-0 flex-1 border-t border-slate-200/80 pt-3"
        data-testid="app-sidebar-knowledge"
      >
        <Badge className="mb-2 uppercase tracking-[0.18em] text-slate-500">Knowledge Base</Badge>
        <Button
          className={cn(
            "h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors duration-200",
            route === "/files"
              ? "bg-slate-100 text-slate-900 hover:bg-slate-100"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          )}
          data-testid="sidebar-files-nav"
          onClick={() => onNavigate("/files")}
          size="sm"
          variant="ghost"
          type="button"
        >
          <Folder className="h-4 w-4" />
          <span>Files</span>
        </Button>
      </div>

      <div
        className="relative mt-auto flex items-center gap-2 border-t border-slate-200/80 pt-3"
        data-testid="app-sidebar-status"
      >
        <StatusIndicator status={modelStatus} />
        <VfsStatusIndicator status={vfsStatus} />
        <IndexStatusIndicator status={indexStatus} />
        <VectorDbStatusIndicator status={vectorDbStatus} />
      </div>
    </aside>
  );
}
