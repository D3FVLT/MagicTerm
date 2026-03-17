import type { TransferProgress } from '@magicterm/shared';

interface TransferPanelProps {
  transfers: TransferProgress[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatProgress(transferred: number, total: number): string {
  if (total === 0) return '0%';
  const percent = Math.round((transferred / total) * 100);
  return `${percent}%`;
}

export function TransferPanel({ transfers }: TransferPanelProps) {
  const activeTransfers = transfers.filter(
    (t) => t.status === 'pending' || t.status === 'transferring'
  );
  const completedTransfers = transfers.filter(
    (t) => t.status === 'completed' || t.status === 'error'
  );

  if (transfers.length === 0) return null;

  return (
    <div className="border-t border-[#292e42] bg-[#1f2335]">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs">
        <span className="font-medium text-[#7aa2f7]">
          Transfers {activeTransfers.length > 0 && `(${activeTransfers.length} active)`}
        </span>
      </div>

      <div className="max-h-32 overflow-y-auto">
        {transfers.map((transfer) => (
          <div
            key={transfer.id}
            className="flex items-center gap-3 border-t border-[#292e42]/50 px-3 py-2"
          >
            {/* Direction icon */}
            <div className="flex-shrink-0">
              {transfer.direction === 'upload' ? (
                <svg
                  className="h-4 w-4 text-[#7aa2f7]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
              ) : (
                <svg
                  className="h-4 w-4 text-[#9ece6a]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              )}
            </div>

            {/* File info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="truncate text-sm text-[#c0caf5]">{transfer.filename}</span>
                <span className="ml-2 flex-shrink-0 text-xs text-[#565f89]">
                  {transfer.status === 'completed' ? (
                    <span className="text-[#9ece6a]">Done</span>
                  ) : transfer.status === 'error' ? (
                    <span className="text-red-400">Failed</span>
                  ) : transfer.status === 'cancelled' ? (
                    <span className="text-[#e0af68]">Cancelled</span>
                  ) : (
                    <>
                      {formatBytes(transfer.transferred)} / {formatBytes(transfer.total)}
                    </>
                  )}
                </span>
              </div>

              {/* Progress bar */}
              {(transfer.status === 'transferring' || transfer.status === 'pending') && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#292e42]">
                  <div
                    className={`h-full transition-all ${
                      transfer.direction === 'upload' ? 'bg-[#7aa2f7]' : 'bg-[#9ece6a]'
                    }`}
                    style={{
                      width: transfer.total > 0 ? `${(transfer.transferred / transfer.total) * 100}%` : '0%',
                    }}
                  />
                </div>
              )}

              {/* Error message */}
              {transfer.status === 'error' && transfer.error && (
                <div className="mt-0.5 truncate text-xs text-red-400">{transfer.error}</div>
              )}
            </div>

            {/* Progress percentage */}
            {(transfer.status === 'transferring' || transfer.status === 'pending') && (
              <span className="flex-shrink-0 text-xs text-[#565f89]">
                {formatProgress(transfer.transferred, transfer.total)}
              </span>
            )}

            {/* Status icon */}
            <div className="flex-shrink-0">
              {transfer.status === 'completed' ? (
                <svg className="h-4 w-4 text-[#9ece6a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : transfer.status === 'error' ? (
                <svg className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : transfer.status === 'transferring' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#7aa2f7] border-t-transparent" />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
