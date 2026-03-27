import { useState } from "react";
import { useClips, useDashboardStats } from "../hooks/use-dashboard";

export function ClipsFeed() {
  const [offset, setOffset] = useState(0);
  const [outlet, setOutlet] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const limit = 20;

  const { data, loading, error } = useClips({ offset, limit, outlet, dateFrom, dateTo });
  const { data: stats } = useDashboardStats();

  const outlets = stats
    ? Object.keys(stats.outletBreakdown).sort()
    : [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-white rounded-lg border border-gray-200 p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Outlet</label>
          <select
            value={outlet}
            onChange={(e) => { setOutlet(e.target.value); setOffset(0); }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        {(outlet || dateFrom || dateTo) && (
          <button
            onClick={() => { setOutlet(""); setDateFrom(""); setDateTo(""); setOffset(0); }}
            className="text-sm text-blue hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results */}
      {loading && !data && <p className="text-gray-500">Loading clips...</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {data && (
        <>
          <p className="text-sm text-gray-500">
            Showing {offset + 1}–{Math.min(offset + limit, data.total)} of {data.total} clips
          </p>

          <div className="space-y-3">
            {data.clips.map((clip) => (
              <div key={clip.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <a
                      href={clip.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-navy font-medium hover:underline"
                    >
                      {clip.title}
                    </a>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500">
                      <span className="font-medium text-blue">{clip.outlet}</span>
                      <span>{new Date(clip.publishedAt!).toLocaleDateString()}</span>
                      <span>Ingested {new Date(clip.ingestedAt!).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                {clip.lede && (
                  <p className="mt-2 text-sm text-gray-600 line-clamp-2">{clip.lede}</p>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-4 py-2 text-sm border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= data.total}
              className="px-4 py-2 text-sm border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-100"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
