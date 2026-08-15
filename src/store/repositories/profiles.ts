import type { DbPool } from "../db.js";
import type { UserProfile, UserProfileInput } from "../../health/types.js";

function mapRow(row: {
  user_id: string;
  gender: string | null;
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  activity_level: string | null;
  target_weight_kg: number | null;
  updated_at: string | Date;
}): UserProfile {
  return {
    userId: row.user_id,
    gender: row.gender as UserProfile["gender"] ?? undefined,
    age: row.age ?? undefined,
    weightKg: row.weight_kg ?? undefined,
    heightCm: row.height_cm ?? undefined,
    activityLevel: row.activity_level as UserProfile["activityLevel"] ?? undefined,
    targetWeightKg: row.target_weight_kg ?? undefined,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export class UserProfileRepository {
  constructor(private readonly pool: DbPool) {}

  async get(userId: string): Promise<UserProfile | undefined> {
    const result = await this.pool.query(
      `SELECT user_id, gender, age, weight_kg, height_cm, activity_level, target_weight_kg, updated_at
       FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async upsert(input: UserProfileInput): Promise<UserProfile> {
    // Merge with existing profile (partial update)
    const existing = await this.get(input.userId);

    const profile: UserProfileInput = {
      userId: input.userId,
      gender: input.gender ?? existing?.gender,
      age: input.age ?? existing?.age,
      weightKg: input.weightKg ?? existing?.weightKg,
      heightCm: input.heightCm ?? existing?.heightCm,
      activityLevel: input.activityLevel ?? existing?.activityLevel,
      targetWeightKg: input.targetWeightKg ?? existing?.targetWeightKg,
    };

    const result = await this.pool.query(
      `INSERT INTO user_profiles (user_id, gender, age, weight_kg, height_cm, activity_level, target_weight_kg, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         gender = COALESCE($2, user_profiles.gender),
         age = COALESCE($3, user_profiles.age),
         weight_kg = COALESCE($4, user_profiles.weight_kg),
         height_cm = COALESCE($5, user_profiles.height_cm),
         activity_level = COALESCE($6, user_profiles.activity_level),
         target_weight_kg = COALESCE($7, user_profiles.target_weight_kg),
         updated_at = NOW()
       RETURNING user_id, gender, age, weight_kg, height_cm, activity_level, target_weight_kg, updated_at`,
      [
        profile.userId,
        profile.gender ?? null,
        profile.age ?? null,
        profile.weightKg ?? null,
        profile.heightCm ?? null,
        profile.activityLevel ?? null,
        profile.targetWeightKg ?? null,
      ],
    );

    return mapRow(result.rows[0]);
  }
}
