import { useRemarks } from "../hooks/use-dashboard";

export function RemarksList() {
  const { data, loading, error } = useRemarks();

  if (loading && !data) return <p className="text-gray-500">Loading remarks...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;
  if (!data || data.remarks.length === 0) return <p className="text-gray-500">No remarks documents found.</p>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Event</th>
            <th className="px-4 py-3">Venue</th>
            <th className="px-4 py-3 text-right">Chunks</th>
            <th className="px-4 py-3">Ingested</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.remarks.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-navy">{r.title}</td>
              <td className="px-4 py-3 text-gray-600">{r.date}</td>
              <td className="px-4 py-3 text-gray-600">{r.event}</td>
              <td className="px-4 py-3 text-gray-600">{r.venue}</td>
              <td className="px-4 py-3 text-gray-600 text-right">{r.chunkCount ?? "—"}</td>
              <td className="px-4 py-3 text-gray-400">
                {r.ingestedAt ? new Date(r.ingestedAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
