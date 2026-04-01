import { useEffect, useMemo, useRef, useState } from "react";

type CrepeModule = typeof import("@milkdown/crepe");
type CrepeInstance = InstanceType<CrepeModule["Crepe"]>;

const disabledFeatures = (Crepe: CrepeModule["Crepe"]) => ({
  [Crepe.Feature.BlockEdit]: false,
  [Crepe.Feature.Cursor]: false,
  [Crepe.Feature.ImageBlock]: false,
  [Crepe.Feature.LinkTooltip]: false,
  [Crepe.Feature.Placeholder]: false,
  [Crepe.Feature.Toolbar]: false,
});

export function MarkdownViewer({ markdown }: { markdown: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<CrepeInstance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !rootRef.current) {
      return;
    }

    let active = true;

    const mount = async () => {
      setLoading(true);
      const { Crepe } = await import("@milkdown/crepe");
      if (!active || !rootRef.current) {
        return;
      }

      const crepe = new Crepe({
        root: rootRef.current,
        defaultValue: markdown,
        features: disabledFeatures(Crepe),
      });

      crepe.setReadonly(true);
      instanceRef.current = crepe;

      try {
        await crepe.create();
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void mount();

    return () => {
      active = false;
      const current = instanceRef.current;
      instanceRef.current = null;
      if (current) {
        void current.destroy();
      }
      if (rootRef.current) {
        rootRef.current.innerHTML = "";
      }
    };
  }, [markdown]);

  const fallback = useMemo(
    () => (
      <article className="text-sm leading-7 prose whitespace-pre-wrap prose-slate max-w-none text-slate-700">
        {markdown}
      </article>
    ),
    [markdown]
  );

  if (typeof window === "undefined") {
    return fallback;
  }

  return (
    <div className="relative">
      {loading ? (
        <div className="absolute inset-x-0 top-0 z-10 text-sm pointer-events-none text-slate-500">
          Rendering markdown...
        </div>
      ) : null}
      <div
        ref={rootRef}
        data-testid="markdown-crepe-root"
        className="milkdown markdown-crepe-viewer"
      />
    </div>
  );
}
