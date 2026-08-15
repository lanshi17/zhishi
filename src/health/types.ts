export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export type Intensity = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";
export type GoalType = "calorie_intake" | "calorie_burn" | "weight";
export type GoalPeriod = "daily" | "weekly" | "monthly";
export type ReportPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
export type Gender = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export type DietRecord = {
  id: string;
  userId: string;
  foodName: string;
  quantity: number;
  unit: string;
  meal: Meal;
  calories: number;
  confidence: Confidence;
  kbSource?: string;
  kbMatchedName?: string;
  rawText: string;
  recordDate: string;
  createdAt: string;
  updatedAt: string;
};

export type DietInput = {
  userId: string;
  foodName: string;
  quantity?: number;
  unit?: string;
  meal: Meal;
  calories: number;
  confidence?: Confidence;
  kbSource?: string;
  kbMatchedName?: string;
  rawText: string;
  recordDate: string;
};

export type ExerciseRecord = {
  id: string;
  userId: string;
  exerciseName: string;
  durationMin?: number;
  distanceKm?: number;
  intensity?: Intensity;
  calories: number;
  confidence: Confidence;
  kbSource?: string;
  kbMatchedName?: string;
  rawText: string;
  recordDate: string;
  createdAt: string;
  updatedAt: string;
};

export type ExerciseInput = {
  userId: string;
  exerciseName: string;
  durationMin?: number;
  distanceKm?: number;
  intensity?: Intensity;
  calories: number;
  confidence?: Confidence;
  kbSource?: string;
  kbMatchedName?: string;
  rawText: string;
  recordDate: string;
};

export type UserGoal = {
  id: string;
  userId: string;
  goalType: GoalType;
  targetValue: number;
  unit: string;
  period: GoalPeriod;
  active: boolean;
  createdAt: string;
};

export type GoalInput = {
  userId: string;
  goalType: GoalType;
  targetValue: number;
  unit: string;
  period?: GoalPeriod;
};

export type ReportSnapshot = {
  id: string;
  userId: string;
  periodType: ReportPeriod;
  periodStart: string;
  periodEnd: string;
  summaryJson: unknown;
  createdAt: string;
};

export type ReportSnapshotInput = {
  userId: string;
  periodType: ReportPeriod;
  periodStart: string;
  periodEnd: string;
  summaryJson: unknown;
};

export type UserProfile = {
  userId: string;
  gender?: Gender;
  age?: number;
  weightKg?: number;
  heightCm?: number;
  activityLevel?: ActivityLevel;
  targetWeightKg?: number;
  updatedAt: string;
};

export type UserProfileInput = {
  userId: string;
  gender?: Gender;
  age?: number;
  weightKg?: number;
  heightCm?: number;
  activityLevel?: ActivityLevel;
  targetWeightKg?: number;
};

/** Computed health metrics derived from user profile */
export type HealthMetrics = {
  bmr?: number;        // Basal Metabolic Rate (kcal/day) - Mifflin-St Jeor
  tdee?: number;       // Total Daily Energy Expenditure (kcal/day)
  bmi?: number;        // Body Mass Index
  bmiCategory?: string;
  proteinG?: number;   // Recommended daily protein (g)
  carbsG?: number;     // Recommended daily carbs (g)
  fatG?: number;       // Recommended daily fat (g)
};

export type DietSummary = {
  totalCalories: number;
  byMeal: Record<string, number>;
  items: DietRecord[];
};

export type DietRangeSummary = {
  totalCalories: number;
  avgDaily: number;
  recordCount: number;
  byMeal: Record<string, number>;
};

export type ExerciseSummary = {
  totalCalories: number;
  items: ExerciseRecord[];
};

export type ExerciseRangeSummary = {
  totalCalories: number;
  avgDaily: number;
  recordCount: number;
  byExercise: Record<string, number>;
};

export type Report = {
  periodType: ReportPeriod;
  periodStart: string;
  periodEnd: string;
  totalIntake: number;
  exerciseBurn: number;
  basalBurn: number;
  totalBurn: number;
  netCalories: number;
  avgDailyIntake: number;
  avgDailyBurn: number;
  recordCount: number;
  dietBreakdown: Array<{ meal: string; calories: number; percentage: number }>;
  exerciseBreakdown: Array<{ name: string; calories: number; percentage: number }>;
  trend?: "increasing" | "decreasing" | "stable";
  insights: string[];
  advice: string[];
};

export type IntentKind =
  | "record_diet"
  | "record_exercise"
  | "query_report"
  | "query_history"
  | "correct_record"
  | "delete_record"
  | "set_goal"
  | "get_advice"
  | "set_profile"
  | "query_profile"
  | "chat";

export type AgentEntities = {
  foodName?: string;
  quantity?: number;
  unit?: string;
  meal?: Meal;
  exerciseName?: string;
  durationMin?: number;
  distanceKm?: number;
  intensity?: Intensity;
  exerciseWeightKg?: number; // 锻炼负荷（如深蹲重量）
  recordedAt?: string; // 记录时间，格式：HH:MM
  period?: ReportPeriod;
  date?: string;
  targetDescription?: string;
  goalType?: GoalType;
  targetValue?: number;
  topic?: string;
  deleteTarget?: "diet" | "exercise";
  // Profile fields
  gender?: Gender;
  age?: number;
  weightKg?: number;
  heightCm?: number;
  activityLevel?: ActivityLevel;
  targetWeightKg?: number;
  // Fields populated by knowledge base merge stage
  calories?: number;
  confidence?: Confidence;
  kbSource?: string;
  kbMatchedName?: string;
};

export type AgentPlanOutput = {
  intent: IntentKind;
  entities: AgentEntities;
  reply: string;
};

export type AgentContext = {
  todayDietRecords: DietRecord[];
  todayExerciseRecords: ExerciseRecord[];
  activeGoals: UserGoal[];
  recentEvents: Array<{ kind: string; summary: string }>;
  knowledgeAvailable: boolean;
  userProfile?: UserProfile;
};

export type KnowledgeResult = {
  confidence: Confidence;
  calories?: number;
  matchedName?: string;
  protein?: number;
  carbs?: number;
  fat?: number;
  met?: number;
  advice?: string[];
  rawResponse?: string;
};
