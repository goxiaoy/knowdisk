import { FileText, Folder, MessageCircle, Search, SlidersHorizontal } from "lucide-react";
import type { RendererModelStatus } from "../../../shared/model-status";
import type { RendererVfsStatus } from "../../../shared/vfs-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SidebarNavItem } from "./sidebar-nav-item";
import { StatusIndicator } from "./status-indicator";
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
  vfsStatus,
}: {
  route: MainRoute;
  onNavigate: (route: MainRoute) => void;
  modelStatus: RendererModelStatus;
  vfsStatus: RendererVfsStatus;
}) {
  return (
    <Card className="flex min-h-[calc(100vh-2rem)] flex-col rounded-3xl p-4 shadow-[0_10px_30px_rgba(15,23,42,0.08)] md:min-h-[calc(100vh-2rem)] md:p-5">
      <div className="flex items-center justify-between pb-4">
        <div>
          <p className="text-lg font-semibold text-slate-900">KnowDisk</p>
          <p className="text-xs text-slate-500">Desktop workspace</p>
        </div>
        <Button className="rounded-xl" size="icon" variant="outline" type="button">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1 border-b border-slate-100 pb-4">
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

      <div className="pt-4">
        <Badge className="mb-2 uppercase tracking-[0.18em] text-slate-500">Knowledge Base</Badge>
        <Button
          className={cn(
            "h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors duration-200",
            route === "/files"
              ? "bg-slate-100 text-slate-900 hover:bg-slate-100"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          )}
          onClick={() => onNavigate("/files")}
          size="sm"
          variant="ghost"
          type="button"
        >
          <Folder className="h-4 w-4" />
          <span>Files</span>
          <FileText className="ml-auto h-4 w-4 text-slate-400" />
        </Button>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <VfsStatusIndicator status={vfsStatus} />
        <StatusIndicator status={modelStatus} />
      </div>
    </Card>
  );
}
