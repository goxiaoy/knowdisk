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
      const [{ Milkdown, useEditor }, core, { commonmark }, { nord }] = await Promise.all([
        import("@milkdown/react"),
        import("@milkdown/kit/core"),
        import("@milkdown/kit/preset/commonmark"),
        import("@milkdown/theme-nord"),
      ]);

      const DynamicRenderer = ({ markdown: value }: MilkdownRendererProps) => {
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

        if (editor.loading) {
          return <div className="text-sm text-slate-500">Rendering markdown...</div>;
        }

        return <Milkdown />;
      };

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
      <article className="prose prose-slate max-w-none whitespace-pre-wrap text-sm leading-7 text-slate-700">
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
