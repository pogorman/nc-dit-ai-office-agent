import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getContainer } from "../shared/cosmos-client";
import { DashboardStats, IngestionRun, NewsClip, RemarksMetadata } from "../shared/types";

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats
// ---------------------------------------------------------------------------

async function dashboardStats(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const clipsContainer = getContainer("clips");
  const remarksContainer = getContainer("remarks-metadata");
  const runsContainer = getContainer("ingestion-state");

  const [clipCount, outletRows, latestClip, remarksCount, latestRun] = await Promise.all([
    clipsContainer.items
      .query<{ count: number }>("SELECT VALUE COUNT(1) FROM c")
      .fetchAll()
      .then((r) => r.resources[0] ?? 0),

    clipsContainer.items
      .query<{ outlet: string; count: number }>(
        "SELECT c.outlet, COUNT(1) as count FROM c GROUP BY c.outlet"
      )
      .fetchAll()
      .then((r) => r.resources),

    clipsContainer.items
      .query<{ ingestedAt: string; publishedAt: string }>(
        "SELECT TOP 1 c.ingestedAt, c.publishedAt FROM c ORDER BY c.ingestedAt DESC"
      )
      .fetchAll()
      .then((r) => r.resources[0] ?? null),

    remarksContainer.items
      .query<{ count: number }>("SELECT VALUE COUNT(1) FROM c")
      .fetchAll()
      .then((r) => r.resources[0] ?? 0),

    runsContainer.items
      .query<IngestionRun>("SELECT TOP 1 * FROM c ORDER BY c.completedAt DESC")
      .fetchAll()
      .then((r) => r.resources[0] ?? null),
  ]);

  const outletBreakdown: Record<string, number> = {};
  for (const row of outletRows) {
    outletBreakdown[row.outlet] = row.count;
  }

  const stats: DashboardStats = {
    totalClips: typeof clipCount === "number" ? clipCount : 0,
    totalRemarks: typeof remarksCount === "number" ? remarksCount : 0,
    outletBreakdown,
    latestClipDate: latestClip?.publishedAt ?? null,
    latestIngestTime: latestClip?.ingestedAt ?? null,
    latestRun: latestRun,
  };

  return { jsonBody: stats };
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/clips
// ---------------------------------------------------------------------------

async function dashboardClips(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const offset = parseInt(request.query.get("offset") ?? "0", 10);
  const limit = Math.min(parseInt(request.query.get("limit") ?? "20", 10), 50);
  const outlet = request.query.get("outlet") ?? "";
  const dateFrom = request.query.get("dateFrom") ?? "";
  const dateTo = request.query.get("dateTo") ?? "";

  const conditions: string[] = [];
  const params: Array<{ name: string; value: string }> = [];

  if (outlet) {
    conditions.push("c.outlet = @outlet");
    params.push({ name: "@outlet", value: outlet });
  }
  if (dateFrom) {
    conditions.push("c.publishedAt >= @dateFrom");
    params.push({ name: "@dateFrom", value: dateFrom });
  }
  if (dateTo) {
    conditions.push("c.publishedAt <= @dateTo");
    params.push({ name: "@dateTo", value: dateTo });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countQuery = `SELECT VALUE COUNT(1) FROM c ${where}`;
  const { resources: countResult } = await getContainer("clips").items
    .query<number>({ query: countQuery, parameters: params })
    .fetchAll();
  const total = countResult[0] ?? 0;

  const dataQuery = `SELECT c.id, c.url, c.outlet, c.title, c.publishedAt, c.lede, c.ingestedAt FROM c ${where} ORDER BY c.publishedAt DESC OFFSET ${offset} LIMIT ${limit}`;
  const { resources: clips } = await getContainer("clips").items
    .query<Partial<NewsClip>>({
      query: dataQuery,
      parameters: params,
    })
    .fetchAll();

  return { jsonBody: { clips, total, offset, limit } };
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/remarks
// ---------------------------------------------------------------------------

async function dashboardRemarks(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const { resources: remarks } = await getContainer("remarks-metadata").items
    .query<RemarksMetadata>("SELECT * FROM c ORDER BY c.date DESC")
    .fetchAll();

  return { jsonBody: { remarks, count: remarks.length } };
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/runs
// ---------------------------------------------------------------------------

async function dashboardRuns(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const limit = Math.min(parseInt(request.query.get("limit") ?? "20", 10), 100);

  const { resources: runs } = await getContainer("ingestion-state").items
    .query<IngestionRun>(`SELECT * FROM c ORDER BY c.completedAt DESC OFFSET 0 LIMIT ${limit}`)
    .fetchAll();

  return { jsonBody: { runs, count: runs.length } };
}

// ---------------------------------------------------------------------------
// Route registrations
// ---------------------------------------------------------------------------

app.http("dashboard-stats", {
  methods: ["GET"],
  authLevel: "function",
  route: "dashboard/stats",
  handler: dashboardStats,
});

app.http("dashboard-clips", {
  methods: ["GET"],
  authLevel: "function",
  route: "dashboard/clips",
  handler: dashboardClips,
});

app.http("dashboard-remarks", {
  methods: ["GET"],
  authLevel: "function",
  route: "dashboard/remarks",
  handler: dashboardRemarks,
});

app.http("dashboard-runs", {
  methods: ["GET"],
  authLevel: "function",
  route: "dashboard/runs",
  handler: dashboardRuns,
});
