// Health tracking mode: all actions auto-approved.
// The health pipeline bypasses tool execution entirely;
// this policy only affects the legacy generic runtime path.
export const approvalRequiredTools = new Set<string>([]);
