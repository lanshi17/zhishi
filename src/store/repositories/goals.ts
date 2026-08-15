import type { DbPool } from "../db.js";
import type { UserGoal, GoalInput, GoalType, GoalPeriod } from "../../health/types.js";

export class GoalRepository {
  constructor(private readonly pool: DbPool) {}

  async set(input: GoalInput): Promise<UserGoal> {
    // Deactivate existing goals of the same type and period for this user
    await this.pool.query(
      `UPDATE user_goals SET active = FALSE
       WHERE user_id = $1 AND goal_type = $2 AND period = $3 AND active = TRUE`,
      [input.userId, input.goalType, input.period ?? "daily"],
    );

    const id = crypto.randomUUID();
    const period: GoalPeriod = input.period ?? "daily";
    await this.pool.query(
      `INSERT INTO user_goals (id, user_id, goal_type, target_value, unit, period, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [id, input.userId, input.goalType, input.targetValue, input.unit, period],
    );

    const result = await this.pool.query(
      "SELECT * FROM user_goals WHERE id = $1",
      [id],
    );
    return mapRow(result.rows[0]);
  }

  async getActive(userId: string): Promise<UserGoal[]> {
    const result = await this.pool.query(
      "SELECT * FROM user_goals WHERE user_id = $1 AND active = TRUE ORDER BY created_at DESC",
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async getActiveByType(
    userId: string,
    goalType: GoalType,
  ): Promise<UserGoal | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM user_goals
       WHERE user_id = $1 AND goal_type = $2 AND active = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [userId, goalType],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async deactivate(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE user_goals SET active = FALSE WHERE id = $1",
      [id],
    );
  }
}

function mapRow(row: Record<string, unknown>): UserGoal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    goalType: row.goal_type as GoalType,
    targetValue: Number(row.target_value),
    unit: row.unit as string,
    period: row.period as GoalPeriod,
    active: Boolean(row.active),
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}
