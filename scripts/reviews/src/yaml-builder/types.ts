// ---------------------------------------------------------------------------
// YAML output schema types
// ---------------------------------------------------------------------------

export interface YamlDocument {
  schema: "pr-review-comments";
  schema_version: "1.0";
  pr: PrMetadata;
  reviewers: Reviewer[];
  comments: YamlComment[];
}

export interface PrMetadata {
  number: number;
  title: string;
  url: string;
  author: string;
  base: string;
  head: string;
  created_at: string;
  files_changed: number;
}

export interface Reviewer {
  id: string;
  display_name: string;
  type: "bot" | "human";
  config_notes: string | null;
}

export interface YamlComment {
  id: string;
  reviewer: string;
  type: "review_summary" | "inline" | "general";
  disposition: string | null;
  file: string | null;
  line: number | null;
  line_range: [number, number] | null;
  severity: string | null;
  category: string | null;
  title: string | null;
  body: string;
  suggested_fix: string | null;
  code_snippet: string | null;
  ai_agent_prompt: string | null;
  related_locations: string[] | null;
  is_outdated: boolean;
}

// ---------------------------------------------------------------------------
// Bot parser interface
// ---------------------------------------------------------------------------

export interface BotParser {
  parseSeverity(body: string): string | null;
  parseCategory(body: string): string | null;
  parseTitle(body: string): string | null;
  parseSuggestedFix(body: string): string | null;
  parseAiAgentPrompt(body: string): string | null;
  parseConfigNotes(body: string): string | null;
  parseDisposition(body: string): string | null;
  parseRelatedLocations(body: string): string[] | null;
  explodeSummary(
    summaryId: string,
    body: string,
    file: string | null,
  ): ExplodedComment[];
}

export interface ExplodedComment {
  id: string;
  file: string | null;
  line: number | null;
  severity: string | null;
  category: string | null;
  title: string | null;
  body: string;
  suggested_fix: string | null;
}
