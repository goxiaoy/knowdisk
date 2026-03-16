import type { ReactNode } from "react";

export function StatusTooltip({
  title,
  widthClassName = "w-72",
  children,
}: {
  title: string;
  widthClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`pointer-events-none absolute bottom-full left-0 z-20 mb-2 rounded-2xl border border-slate-200 bg-white p-3 opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${widthClassName}`}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</p>
      {children}
    </div>
  );
}
