import type { ActivityLevel, Gender, HealthMetrics, UserProfile } from "./types.js";

/**
 * BMR calculation using Mifflin-St Jeor equation (most accurate for general population):
 *   Male:   10 × weight(kg) + 6.25 × height(cm) - 5 × age + 5
 *   Female: 10 × weight(kg) + 6.25 × height(cm) - 5 × age - 161
 */
export function calculateBMR(profile: UserProfile): number | undefined {
  const { weightKg, heightCm, age, gender } = profile;
  if (!weightKg || !heightCm || !age || !gender) return undefined;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(gender === "male" ? base + 5 : base - 161);
}

/**
 * Activity level multipliers for TDEE calculation.
 * Based on standard Harris-Benedict activity factors.
 */
const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,    // Little or no exercise
  light: 1.375,      // Light exercise 1-3 days/week
  moderate: 1.55,    // Moderate exercise 3-5 days/week
  active: 1.725,     // Hard exercise 6-7 days/week
  very_active: 1.9,  // Very hard exercise, physical job
};

/**
 * TDEE = BMR × activity multiplier
 * Total Daily Energy Expenditure
 */
export function calculateTDEE(profile: UserProfile): number | undefined {
  const bmr = calculateBMR(profile);
  if (bmr === undefined) return undefined;

  const multiplier = ACTIVITY_MULTIPLIERS[profile.activityLevel ?? "sedentary"];
  return Math.round(bmr * multiplier);
}

/**
 * BMI = weight(kg) / (height(m))²
 */
export function calculateBMI(profile: UserProfile): { bmi: number; category: string } | undefined {
  const { weightKg, heightCm } = profile;
  if (!weightKg || !heightCm) return undefined;

  const heightM = heightCm / 100;
  const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;

  let category: string;
  if (bmi < 18.5) category = "偏瘦";
  else if (bmi < 24) category = "正常";
  else if (bmi < 28) category = "偏胖";
  else category = "肥胖";

  return { bmi, category };
}

/**
 * Recommended macronutrient distribution based on TDEE:
 *   Protein: 25-30% of calories (4 kcal/g)
 *   Carbs:   45-55% of calories (4 kcal/g)
 *   Fat:     20-30% of calories (9 kcal/g)
 *
 * Adjusted for activity level and goals.
 */
export function calculateMacros(profile: UserProfile): { proteinG: number; carbsG: number; fatG: number } | undefined {
  const tdee = calculateTDEE(profile);
  if (tdee === undefined) return undefined;

  // Adjust protein based on activity level (higher activity → more protein)
  let proteinPct: number;
  switch (profile.activityLevel) {
    case "very_active": proteinPct = 0.30; break;
    case "active":      proteinPct = 0.28; break;
    case "moderate":    proteinPct = 0.25; break;
    case "light":       proteinPct = 0.22; break;
    default:            proteinPct = 0.20; break;
  }

  const fatPct = 0.25;
  const carbsPct = 1 - proteinPct - fatPct;

  return {
    proteinG: Math.round((tdee * proteinPct) / 4),
    carbsG: Math.round((tdee * carbsPct) / 4),
    fatG: Math.round((tdee * fatPct) / 9),
  };
}

/**
 * Compute all health metrics for a user profile.
 */
export function computeHealthMetrics(profile: UserProfile): HealthMetrics {
  const bmr = calculateBMR(profile);
  const tdee = calculateTDEE(profile);
  const bmiResult = calculateBMI(profile);
  const macros = calculateMacros(profile);

  return {
    bmr,
    tdee,
    bmi: bmiResult?.bmi,
    bmiCategory: bmiResult?.category,
    proteinG: macros?.proteinG,
    carbsG: macros?.carbsG,
    fatG: macros?.fatG,
  };
}

/**
 * Get the user's weight for MET-based calorie calculations.
 * Falls back to default 70kg if profile not available.
 */
export function getUserWeightKg(profile: UserProfile | undefined): number {
  return profile?.weightKg ?? 70;
}

/** Map Chinese activity level descriptions to enum values */
export function parseActivityLevel(text: string): ActivityLevel | undefined {
  const lower = text.toLowerCase().trim();
  if (lower.includes("久坐") || lower.includes("不动") || lower === "sedentary") return "sedentary";
  if (lower.includes("轻度") || lower.includes("偶尔") || lower === "light") return "light";
  if (lower.includes("中等") || lower.includes("规律") || lower === "moderate") return "moderate";
  if (lower.includes("积极") || lower.includes("高频") || lower === "active") return "active";
  if (lower.includes("非常") || lower.includes("专业") || lower === "very_active") return "very_active";
  return undefined;
}

/** Map Chinese gender descriptions to enum values */
export function parseGender(text: string): Gender | undefined {
  const lower = text.toLowerCase().trim();
  if (lower.includes("男") || lower === "male" || lower === "m") return "male";
  if (lower.includes("女") || lower === "female" || lower === "f") return "female";
  return undefined;
}

/** Format activity level to Chinese display text */
export function formatActivityLevel(level: ActivityLevel): string {
  const map: Record<ActivityLevel, string> = {
    sedentary: "久坐（几乎不运动）",
    light: "轻度运动（每周1-3天）",
    moderate: "中等运动（每周3-5天）",
    active: "积极运动（每周6-7天）",
    very_active: "高强度运动（体力劳动/双练）",
  };
  return map[level] ?? level;
}
