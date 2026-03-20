import { useEffect, useMemo, useState, type ComponentType } from "react";

type MilkdownRendererProps = {
  markdown: string;
};

export function MarkdownViewer({ markdown }: { markdown: string }) {
  const [Renderer, setRenderer] = useState<ComponentType<MilkdownRendererProps> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let active = true;

    const load = async () => {
      const [{ Milkdown, MilkdownProvider, useEditor }, core, { commonmark }, { nord }] =
        await Promise.all([
        import("@milkdown/react"),
        import("@milkdown/kit/core"),
        import("@milkdown/kit/preset/commonmark"),
        import("@milkdown/theme-nord"),
        ]);

      const DynamicRendererInner = ({ markdown: value }: MilkdownRendererProps) => {
        const editor = useEditor(
          (root) =>
            core.Editor.make()
              .config((ctx) => {
                ctx.set(core.rootCtx, root);
                ctx.set(core.defaultValueCtx, value);
                ctx.set(core.editorViewOptionsCtx, {
                  editable: () => false,
                });
              })
              .use(commonmark)
              .use(nord),
          [value]
        );

        return (
          <div className="relative">
            {editor.loading ? (
              <div className="absolute inset-x-0 top-0 z-10 text-sm pointer-events-none text-slate-500">
                Rendering markdown...
              </div>
            ) : null}
            <Milkdown />
          </div>
        );
      };

      const DynamicRenderer = ({ markdown: value }: MilkdownRendererProps) => (
        <MilkdownProvider>
          <DynamicRendererInner markdown={value} />
        </MilkdownProvider>
      );

      if (active) {
        setRenderer(() => DynamicRenderer);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const fallback = useMemo(
    () => (
      <article className="text-sm leading-7 prose whitespace-pre-wrap prose-slate max-w-none text-slate-700">
        {markdown}
      </article>
    ),
    [markdown]
  );

  if (!Renderer || typeof window === "undefined") {
    return fallback;
  }

  return <Renderer markdown={markdown} />;
}
