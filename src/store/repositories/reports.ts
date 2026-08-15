import type { DbPool } from "../db.js";
import type {
  ReportSnapshot,
  ReportSnapshotInput,
  ReportPeriod,
} from "../../health/types.js";

export class ReportRepository {
  constructor(private readonly pool: DbPool) {}

  async save(input: ReportSnapshotInput): Promise<ReportSnapshot> {
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO report_snapshots (id, user_id, period_type, period_start, period_end, summary_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.userId,
        input.periodType,
        input.periodStart,
        input.periodEnd,
        JSON.stringify(input.summaryJson),
      ],
    );

    const result = await this.pool.query(
      "SELECT * FROM report_snapshots WHERE id = $1",
      [id],
    );
    return mapRow(result.rows[0]);
  }

  async get(
    userId: string,
    periodType: ReportPeriod,
    periodStart: string,
  ): Promise<ReportSnapshot | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM report_snapshots
       WHERE user_id = $1 AND period_type = $2 AND period_start = $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, periodType, periodStart],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async invalidate(
    userId: string,
    periodType: ReportPeriod,
    periodStart: string,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM report_snapshots
       WHERE user_id = $1 AND period_type = $2 AND period_start = $3`,
      [userId, periodType, periodStart],
    );
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapRow(row: Record<string, unknown>): ReportSnapshot {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    periodType: row.period_type as ReportPeriod,
    periodStart: row.period_start instanceof Date
      ? formatDate(row.period_start)
      : String(row.period_start),
    periodEnd: row.period_end instanceof Date
      ? formatDate(row.period_end)
      : String(row.period_end),
    summaryJson: typeof row.summary_json === "string"
      ? JSON.parse(row.summary_json)
      : row.summary_json,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}
