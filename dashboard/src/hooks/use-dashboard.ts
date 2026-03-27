import { get } from "../api/client";
import type { DashboardStats, IngestionRun, NewsClip, RemarksMetadata } from "@shared/types";
import { useFetch } from "./use-fetch";

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function useDashboardStats() {
  return useFetch(() => get<DashboardStats>("/dashboard/stats"), []);
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

interface ClipsResponse {
  clips: NewsClip[];
  total: number;
  offset: number;
  limit: number;
}

interface ClipsParams {
  offset?: number;
  limit?: number;
  outlet?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useClips(params: ClipsParams = {}) {
  const { offset = 0, limit = 20, outlet = "", dateFrom = "", dateTo = "" } = params;
  return useFetch(
    () =>
      get<ClipsResponse>("/dashboard/clips", {
        offset: String(offset),
        limit: String(limit),
        outlet,
        dateFrom,
        dateTo,
      }),
    [offset, limit, outlet, dateFrom, dateTo]
  );
}

// ---------------------------------------------------------------------------
// Remarks
// ---------------------------------------------------------------------------

interface RemarksResponse {
  remarks: RemarksMetadata[];
  count: number;
}

export function useRemarks() {
  return useFetch(() => get<RemarksResponse>("/dashboard/remarks"), []);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

interface RunsResponse {
  runs: IngestionRun[];
  count: number;
}

export function useRuns(limit = 20) {
  return useFetch(
    () => get<RunsResponse>("/dashboard/runs", { limit: String(limit) }),
    [limit]
  );
}
