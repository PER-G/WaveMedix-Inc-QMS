// ═══ CENTRAL AI MODEL CONFIGURATION ═══
// Single source of truth for the Anthropic model used across all API routes
// (chat, formsheet, sop-rules, audit). Anthropic retires dated model
// snapshots over time — when that happens the API returns a 404
// not_found_error. Keeping the model ID here means one edit fixes every
// caller instead of hunting down hardcoded strings in multiple files.
//
// Overridable at deploy time via the ANTHROPIC_MODEL env var.
export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Default max tokens for a standard chat / generation call.
export const AI_MAX_TOKENS = 4096;
