import type { BotParser, ExplodedComment } from "../types.js";

// @bot-specific(coderabbit): All patterns in this parser depend on CodeRabbit's
// comment structure (emoji badges, HTML summary/details blocks, bracket markers).
// Verify: check a recent CodeRabbit review if parsing stops extracting fields.
export class CodeRabbitParser implements BotParser {
  parseSeverity(body: string): string | null {
    // @bot-specific(coderabbit): Severity via emoji badges and bracket markers
    // Emoji badges: red circle Critical, orange Major, yellow Minor, green Low
    if (/\u{1F534}\s*Critical/u.test(body)) return "critical";
    if (/\u{1F7E0}\s*Major/u.test(body)) return "major";
    if (/\u{1F7E1}\s*Minor/u.test(body)) return "minor";
    if (/\u{1F7E2}\s*Low/u.test(body)) return "low";
    // Also check text-based severity markers
    if (/\[Critical\]/i.test(body)) return "critical";
    if (/\[Major\]/i.test(body)) return "major";
    if (/\[Minor\]/i.test(body)) return "minor";
    if (/\[Low\]/i.test(body)) return "low";
    return null;
  }

  parseCategory(body: string): string | null {
    if (/\u{26A0}\u{FE0F}\s*Potential issue/u.test(body))
      return "potential_issue";
    if (/\u{1F512}\s*Security/u.test(body)) return "security";
    if (/\u{1F41B}\s*Bug/u.test(body)) return "bug";
    if (/\u{26A1}\s*Performance/u.test(body)) return "performance";
    if (/\u{1F4DD}\s*Documentation/u.test(body)) return "documentation";
    if (/\u{1F527}\s*Maintainability/u.test(body)) return "maintainability";
    return null;
  }

  parseTitle(body: string): string | null {
    // First **bold** line after severity badge
    const match = body.match(
      /(?:\u{1F534}|\u{1F7E0}|\u{1F7E1}|\u{1F7E2}|\[(?:Critical|Major|Minor|Low)\]).*?\*\*(.+?)\*\*/u,
    );
    if (match?.[1]) return match[1].trim();
    // Fallback: first **bold** text in the body
    const fallback = body.match(/\*\*(.+?)\*\*/);
    return fallback?.[1]?.trim() ?? null;
  }

  parseSuggestedFix(body: string): string | null {
    // Content in <summary>Proposed fix</summary>
    const proposedMatch = body.match(
      /<summary>\s*Proposed fix\s*<\/summary>\s*([\s\S]*?)(?=<\/details>)/i,
    );
    if (proposedMatch?.[1]?.trim()) return proposedMatch[1].trim();

    // ```diff blocks
    const diffMatch = body.match(/```diff\n([\s\S]*?)```/);
    if (diffMatch?.[1]?.trim()) return diffMatch[1].trim();

    // ```suggestion blocks
    const suggestionMatch = body.match(/```suggestion\n([\s\S]*?)```/);
    if (suggestionMatch?.[1]?.trim()) return suggestionMatch[1].trim();

    return null;
  }

  parseAiAgentPrompt(body: string): string | null {
    const match = body.match(
      /<summary>\s*\u{1F916}\s*Prompt for AI Agents\s*<\/summary>\s*([\s\S]*?)(?=<\/details>)/iu,
    );
    if (!match?.[1]) return null;
    // Extract fenced code block content if present
    const fenced = match[1].match(/```[\s\S]*?\n([\s\S]*?)```/);
    return fenced?.[1]?.trim() ?? match[1].trim();
  }

  parseConfigNotes(body: string): string | null {
    const match = body.match(/Profile:\s*.+?,\s*Plan:\s*.+/i);
    return match?.[0]?.trim() ?? null;
  }

  parseDisposition(body: string): string | null {
    if (/outside\s+diff\s+range/i.test(body)) return "outside_diff_range";
    if (/duplicate\s+comment/i.test(body)) return "duplicate";
    return null;
  }

  parseRelatedLocations(_body: string): string[] | null {
    return null;
  }

  explodeSummary(
    summaryId: string,
    body: string,
    _file: string | null,
  ): ExplodedComment[] {
    const results: ExplodedComment[] = [];

    // Look for nested <details> blocks grouped by severity/file
    // Pattern: severity header + file sections with individual issues
    const issuePattern =
      /(?:#{2,4})\s*(?:`([^`]+)`)?[^\n]*\n([\s\S]*?)(?=(?:#{2,4}\s)|$)/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = issuePattern.exec(body)) !== null) {
      const file = match[1] ?? null;
      const sectionHeader = match[0].split("\n")[0] ?? "";
      const sectionSeverity = this.parseSeverity(sectionHeader);
      const sectionCategory = this.parseCategory(sectionHeader);
      const issueBody = match[2]?.trim();
      if (!issueBody) continue;

      // Each issue block may contain multiple bullet-pointed issues
      const bulletIssues = issueBody.split(/\n(?=[-*]\s+(?:\[[^\]]+\]\s*)?\*\*)/);
      for (const bullet of bulletIssues) {
        const trimmed = bullet.trim();
        if (!trimmed) continue;

        index++;
        results.push({
          id: `${summaryId}_${index}`,
          file,
          line: null,
          severity: this.parseSeverity(trimmed) ?? sectionSeverity,
          category: this.parseCategory(trimmed) ?? sectionCategory,
          title: this.parseTitle(trimmed),
          body: trimmed,
          suggested_fix: this.parseSuggestedFix(trimmed),
        });
      }
    }

    return results;
  }
}
