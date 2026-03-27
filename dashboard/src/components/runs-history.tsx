import { useRuns } from "../hooks/use-dashboard";

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

export function RunsHistory() {
  const { data, loading, error } = useRuns();

  if (loading && !data) return <p className="text-gray-500">Loading run history...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;
  if (!data || data.runs.length === 0) {
    return <p className="text-gray-500">No ingestion runs recorded yet. Trigger a manual refresh or wait for the 7 AM daily run.</p>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th className="px-4 py-3">Trigger</th>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3 text-right">New</th>
            <th className="px-4 py-3 text-right">Skipped</th>
            <th className="px-4 py-3 text-right">Errors</th>
            <th className="px-4 py-3">Sources</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.runs.map((run) => (
            <tr key={run.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                  run.trigger === "timer" ? "bg-blue-50 text-blue" : "bg-gray-100 text-gray-700"
                }`}>
                  {run.trigger}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">
                {new Date(run.startedAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {(run.durationMs / 1000).toFixed(1)}s
              </td>
              <td className="px-4 py-3 text-right font-medium text-green">{run.newCount}</td>
              <td className="px-4 py-3 text-right text-gray-500">{run.skippedCount}</td>
              <td className="px-4 py-3 text-right text-red">{run.errorCount}</td>
              <td className="px-4 py-3 text-gray-500">
                {run.sources.gov}g + {run.sources.web}w
              </td>
              <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
