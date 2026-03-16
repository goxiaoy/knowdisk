import type { FileNodeMetadata } from "../../../shared/files";
import { formatFileNodeMetadataEntries } from "./files-info-format";

export function FileInfoDialog({
  nodeName,
  metadata,
  error,
  loading,
  onClose,
}: {
  nodeName: string;
  metadata: FileNodeMetadata | null;
  error: string;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-white/35 px-4 py-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.14)]"
        data-testid="files-info-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Node Info
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{nodeName}</p>
          </div>
          <button
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading info...</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : metadata ? (
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            {formatFileNodeMetadataEntries(metadata).map((entry) => (
              <div key={entry.key} className="contents">
                <dt className="text-slate-500">{entry.label}</dt>
                <dd className="min-w-0 break-all text-slate-800">{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
