import { MarkdownViewer } from "../markdown-viewer";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

type FilesPreviewProps = {
  previewTitle: string | null;
  previewMarkdown: string;
  loadingPreview: boolean;
  error: string;
};

export function FilesPreview({ previewTitle, previewMarkdown, loadingPreview, error }: FilesPreviewProps) {
  return (
    <Card>
      <CardHeader className="mb-3 border-b border-slate-100 pb-3">
        <CardTitle className="text-lg text-slate-900">{previewTitle ?? "Markdown Preview"}</CardTitle>
        {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </CardHeader>

      <CardContent className="h-[calc(100%-56px)] overflow-auto p-4 pt-0">
        {loadingPreview ? (
          <p className="text-sm text-slate-500">Parsing markdown...</p>
        ) : previewMarkdown ? (
          <MarkdownViewer markdown={previewMarkdown} />
        ) : (
          <p className="text-sm text-slate-500">Select a file from the tree to preview markdown.</p>
        )}
      </CardContent>
    </Card>
  );
}
