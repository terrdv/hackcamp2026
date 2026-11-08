// Server-only: runs SQL on a Databricks SQL warehouse through the Statement Execution REST API.
// Uses plain fetch so it works in the Cloudflare Worker build (no Node driver).
// Needs DATABRICKS_HOST, DATABRICKS_TOKEN and DATABRICKS_HTTP_PATH (same values the pipeline uses).

type Env = Record<string, string | undefined>;

interface StatementResponse {
  statement_id: string;
  status: { state: string; error?: { message?: string } };
  manifest?: { schema: { columns: { name: string; type_name: string }[] } };
  result?: { data_array?: (string | null)[][] };
}

export type SqlParam = { name: string; value: string; type?: "STRING" | "DATE" | "INT" };

function env(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}

function config() {
  const e = env();
  const host = e["DATABRICKS_HOST"]?.replace(/\/+$/, "");
  const token = e["DATABRICKS_TOKEN"];
  const warehouse = e["DATABRICKS_WAREHOUSE_ID"] ?? e["DATABRICKS_HTTP_PATH"]?.split("/").pop();
  if (!host || !token || !warehouse) {
    throw new Error(
      "Databricks is not configured (DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_HTTP_PATH)",
    );
  }
  return { base: host.startsWith("http") ? host : `https://${host}`, token, warehouse };
}

function convert(value: string | null, type: string): unknown {
  if (value == null) return null;
  switch (type) {
    case "INT":
    case "LONG":
    case "SHORT":
    case "BYTE":
    case "DOUBLE":
    case "FLOAT":
    case "DECIMAL":
      return Number(value);
    case "BOOLEAN":
      return value === "true";
    default:
      return value; // strings, DATE (YYYY-MM-DD), TIMESTAMP (ISO)
  }
}

/** Run one statement and return its rows as objects keyed by column name. */
export async function query<T>(statement: string, parameters: SqlParam[] = []): Promise<T[]> {
  const { base, token, warehouse } = config();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let res: StatementResponse = await fetch(`${base}/api/2.0/sql/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      warehouse_id: warehouse,
      statement,
      parameters,
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE",
      format: "JSON_ARRAY",
      disposition: "INLINE",
    }),
  }).then((r) => r.json() as Promise<StatementResponse>);

  // A cold serverless warehouse can take longer than the wait timeout: poll until it finishes.
  for (
    let i = 0;
    i < 20 && (res.status?.state === "PENDING" || res.status?.state === "RUNNING");
    i++
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetch(`${base}/api/2.0/sql/statements/${res.statement_id}`, { headers }).then(
      (r) => r.json() as Promise<StatementResponse>,
    );
  }
  if (res.status?.state !== "SUCCEEDED") {
    throw new Error(
      `Databricks query ${res.status?.state ?? "failed"}: ${res.status?.error?.message ?? "no details"}`,
    );
  }
  const cols = res.manifest?.schema.columns ?? [];
  return (res.result?.data_array ?? []).map(
    (row) =>
      Object.fromEntries(cols.map((c, i) => [c.name, convert(row[i] ?? null, c.type_name)])) as T,
  );
}
