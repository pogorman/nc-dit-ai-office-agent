import { useEffect } from "react";
import { useDashboardStats } from "../hooks/use-dashboard";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-navy mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: "bg-green-100 text-green-800",
    partial: "bg-yellow-100 text-yellow-800",
    failed: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

export function StatsPanel() {
  const { data, loading, error, refetch } = useDashboardStats();

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(refetch, 60_000);
    return () => clearInterval(id);
  }, [refetch]);

  if (loading && !data) return <p className="text-gray-500">Loading stats...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;
  if (!data) return null;

  const outletEntries = Object.entries(data.outletBreakdown).sort((a, b) => b[1] - a[1]);
  const maxCount = outletEntries[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Clips" value={data.totalClips} />
        <StatCard label="Total Remarks" value={data.totalRemarks} />
        <StatCard label="Unique Outlets" value={Object.keys(data.outletBreakdown).length} />
        <StatCard
          label="Latest Ingest"
          value={data.latestIngestTime ? new Date(data.latestIngestTime).toLocaleDateString() : "—"}
        />
      </div>

      {/* Latest run */}
      {data.latestRun && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Latest Run</h3>
            <StatusBadge status={data.latestRun.status} />
            <span className="text-xs text-gray-400">
              {new Date(data.latestRun.completedAt).toLocaleString()}
            </span>
          </div>
          <div className="flex gap-6 text-sm text-gray-600">
            <span><strong className="text-navy">{data.latestRun.newCount}</strong> new</span>
            <span><strong>{data.latestRun.skippedCount}</strong> skipped</span>
            <span><strong>{data.latestRun.errorCount}</strong> errors</span>
            <span className="text-gray-400">
              {data.latestRun.sources.gov} gov + {data.latestRun.sources.web} web
            </span>
            <span className="text-gray-400">
              {(data.latestRun.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}

      {/* Outlet breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Clips by Outlet</h3>
        <div className="space-y-2">
          {outletEntries.map(([outlet, count]) => (
            <div key={outlet} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-40 truncate">{outlet}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-4">
                <div
                  className="bg-blue h-4 rounded-full transition-all"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
