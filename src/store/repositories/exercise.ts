import type { DbPool } from "../db.js";
import type {
  ExerciseRecord,
  ExerciseInput,
  ExerciseSummary,
  ExerciseRangeSummary,
} from "../../health/types.js";

export class ExerciseRepository {
  constructor(private readonly pool: DbPool) {}

  async create(input: ExerciseInput): Promise<ExerciseRecord> {
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO exercise_records
        (id, user_id, exercise_name, duration_min, distance_km, intensity, calories, confidence, kb_source, kb_matched_name, raw_text, record_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        input.userId,
        input.exerciseName,
        input.durationMin ?? null,
        input.distanceKm ?? null,
        input.intensity ?? null,
        input.calories,
        input.confidence ?? "medium",
        input.kbSource ?? null,
        input.kbMatchedName ?? null,
        input.rawText,
        input.recordDate,
      ],
    );
    return this.getOrFail(id);
  }

  async getByDate(userId: string, date: string): Promise<ExerciseRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM exercise_records WHERE user_id = $1 AND record_date = $2 ORDER BY seq ASC`,
      [userId, date],
    );
    return result.rows.map(mapRow);
  }

  async getDailySummary(userId: string, date: string): Promise<ExerciseSummary> {
    const items = await this.getByDate(userId, date);
    const totalCalories = items.reduce((sum, item) => sum + item.calories, 0);
    return { totalCalories, items };
  }

  async getRangeSummary(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<ExerciseRangeSummary> {
    const result = await this.pool.query(
      `SELECT exercise_name, calories FROM exercise_records
       WHERE user_id = $1 AND record_date BETWEEN $2 AND $3 ORDER BY seq ASC`,
      [userId, startDate, endDate],
    );

    const byExercise: Record<string, number> = {};
    let totalCalories = 0;
    for (const row of result.rows) {
      const name = row.exercise_name as string;
      const calories = Number(row.calories);
      byExercise[name] = (byExercise[name] ?? 0) + calories;
      totalCalories += calories;
    }

    const days = countDays(startDate, endDate);
    return {
      totalCalories,
      avgDaily: days > 0 ? totalCalories / days : 0,
      recordCount: result.rows.length,
      byExercise,
    };
  }

  async update(id: string, updates: Partial<ExerciseInput>): Promise<ExerciseRecord | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, string> = {
      exerciseName: "exercise_name",
      durationMin: "duration_min",
      distanceKm: "distance_km",
      intensity: "intensity",
      calories: "calories",
      confidence: "confidence",
      kbSource: "kb_source",
      kbMatchedName: "kb_matched_name",
      rawText: "raw_text",
      recordDate: "record_date",
    };

    for (const [key, value] of Object.entries(updates)) {
      const col = fieldMap[key];
      if (col) {
        fields.push(`${col} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
      }
    }

    if (fields.length === 0) {
      return this.get(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    await this.pool.query(
      `UPDATE exercise_records SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values,
    );

    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("DELETE FROM exercise_records WHERE id = $1", [id]);
  }

  async deleteByExerciseName(userId: string, date: string, exerciseName: string): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM exercise_records WHERE user_id = $1 AND record_date = $2 AND exercise_name = $3",
      [userId, date, exerciseName],
    );
    return result.rowCount ?? 0;
  }

  async deleteLatest(userId: string, date: string): Promise<ExerciseRecord | undefined> {
    const result = await this.pool.query(
      `DELETE FROM exercise_records WHERE id = (
        SELECT id FROM exercise_records WHERE user_id = $1 AND record_date = $2
        ORDER BY created_at DESC LIMIT 1
      ) RETURNING *`,
      [userId, date],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  private async get(id: string): Promise<ExerciseRecord | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM exercise_records WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  private async getOrFail(id: string): Promise<ExerciseRecord> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Exercise record ${id} not found after insert`);
    }
    return record;
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapRow(row: Record<string, unknown>): ExerciseRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    exerciseName: row.exercise_name as string,
    durationMin: row.duration_min != null ? Number(row.duration_min) : undefined,
    distanceKm: row.distance_km != null ? Number(row.distance_km) : undefined,
    intensity: (row.intensity as ExerciseRecord["intensity"]) ?? undefined,
    calories: Number(row.calories),
    confidence: row.confidence as ExerciseRecord["confidence"],
    kbSource: (row.kb_source as string) ?? undefined,
    kbMatchedName: (row.kb_matched_name as string) ?? undefined,
    rawText: row.raw_text as string,
    recordDate: row.record_date instanceof Date
      ? formatDate(row.record_date)
      : String(row.record_date),
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at),
  };
}

function countDays(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
}
