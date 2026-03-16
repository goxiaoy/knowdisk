import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SidebarNavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors duration-200",
        active
          ? "bg-slate-100 text-slate-900 shadow-sm"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
