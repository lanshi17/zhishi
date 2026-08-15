import type { DbPool } from "../db.js";
import type {
  DietRecord,
  DietInput,
  DietSummary,
  DietRangeSummary,
} from "../../health/types.js";

export class DietRepository {
  constructor(private readonly pool: DbPool) {}

  async create(input: DietInput): Promise<DietRecord> {
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO diet_records
        (id, user_id, food_name, quantity, unit, meal, calories, confidence, kb_source, kb_matched_name, raw_text, record_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        input.userId,
        input.foodName,
        input.quantity ?? 1,
        input.unit ?? "份",
        input.meal,
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

  async getByDate(userId: string, date: string): Promise<DietRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM diet_records WHERE user_id = $1 AND record_date = $2 ORDER BY seq ASC`,
      [userId, date],
    );
    return result.rows.map(mapRow);
  }

  async getDailySummary(userId: string, date: string): Promise<DietSummary> {
    const items = await this.getByDate(userId, date);
    const byMeal: Record<string, number> = {};
    let totalCalories = 0;
    for (const item of items) {
      byMeal[item.meal] = (byMeal[item.meal] ?? 0) + item.calories;
      totalCalories += item.calories;
    }
    return { totalCalories, byMeal, items };
  }

  async getRangeSummary(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<DietRangeSummary> {
    const result = await this.pool.query(
      `SELECT meal, calories FROM diet_records
       WHERE user_id = $1 AND record_date BETWEEN $2 AND $3 ORDER BY seq ASC`,
      [userId, startDate, endDate],
    );

    const byMeal: Record<string, number> = {};
    let totalCalories = 0;
    for (const row of result.rows) {
      const meal = row.meal as string;
      const calories = Number(row.calories);
      byMeal[meal] = (byMeal[meal] ?? 0) + calories;
      totalCalories += calories;
    }

    const days = countDays(startDate, endDate);
    return {
      totalCalories,
      avgDaily: days > 0 ? totalCalories / days : 0,
      recordCount: result.rows.length,
      byMeal,
    };
  }

  async update(id: string, updates: Partial<DietInput>): Promise<DietRecord | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, string> = {
      foodName: "food_name",
      quantity: "quantity",
      unit: "unit",
      meal: "meal",
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
      `UPDATE diet_records SET ${fields.join(", ")} WHERE id = $${paramIdx}`,
      values,
    );

    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("DELETE FROM diet_records WHERE id = $1", [id]);
  }

  async deleteByFoodName(userId: string, date: string, foodName: string): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM diet_records WHERE user_id = $1 AND record_date = $2 AND food_name = $3",
      [userId, date, foodName],
    );
    return result.rowCount ?? 0;
  }

  async deleteByMeal(userId: string, date: string, meal: string): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM diet_records WHERE user_id = $1 AND record_date = $2 AND meal = $3",
      [userId, date, meal],
    );
    return result.rowCount ?? 0;
  }

  async deleteLatest(userId: string, date: string): Promise<DietRecord | undefined> {
    const result = await this.pool.query(
      `DELETE FROM diet_records WHERE id = (
        SELECT id FROM diet_records WHERE user_id = $1 AND record_date = $2
        ORDER BY created_at DESC LIMIT 1
      ) RETURNING *`,
      [userId, date],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  private async get(id: string): Promise<DietRecord | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM diet_records WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  private async getOrFail(id: string): Promise<DietRecord> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Diet record ${id} not found after insert`);
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

function mapRow(row: Record<string, unknown>): DietRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    foodName: row.food_name as string,
    quantity: Number(row.quantity),
    unit: row.unit as string,
    meal: row.meal as DietRecord["meal"],
    calories: Number(row.calories),
    confidence: row.confidence as DietRecord["confidence"],
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
