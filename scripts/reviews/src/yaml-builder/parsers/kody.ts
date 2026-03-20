import type { BotParser, ExplodedComment } from "../types.js";

// @bot-specific(kody): All patterns in this parser depend on Kody's comment
// structure (shields.io badge URLs, HTML summary/details blocks, markdown tables).
// Verify: check a recent Kody review if parsing stops extracting fields.
export class KodyParser implements BotParser {
  // @bot-specific(kody): Severity via shields.io badge URL slugs
  parseSeverity(body: string): string | null {
    if (/severity_level-critical/i.test(body)) return "critical";
    if (/severity_level-high/i.test(body)) return "high";
    if (/severity_level-medium/i.test(body)) return "medium";
    if (/severity_level-low/i.test(body)) return "low";
    return null;
  }

  parseCategory(body: string): string | null {
    // Shield badge patterns
    if (/Security/i.test(body) && /shields\.io/i.test(body))
      return "security";
    if (/Bug/i.test(body) && /shields\.io/i.test(body)) return "bug";
    if (/Performance/i.test(body) && /shields\.io/i.test(body))
      return "performance";
    if (/Kody_Rules/i.test(body)) return "kody_rules";

    // Fallback: badge alt text patterns
    if (/!\[Security\]/i.test(body)) return "security";
    if (/!\[Bug\]/i.test(body)) return "bug";
    if (/!\[Performance\]/i.test(body)) return "performance";
    if (/!\[Kody.Rules\]/i.test(body)) return "kody_rules";

    return null;
  }

  parseTitle(body: string): string | null {
    // Strip badge image lines, then take first sentence
    const lines = body.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip badge lines and empty lines
      if (!trimmed || /^!\[/.test(trimmed) || /^<img/i.test(trimmed))
        continue;
      // Take first meaningful sentence
      const sentence = trimmed.match(/^(.+?)[.!?\n]/);
      return sentence?.[1]?.trim() ?? trimmed.slice(0, 120);
    }
    return null;
  }

  parseSuggestedFix(body: string): string | null {
    // ```suggestion blocks
    const suggestionMatch = body.match(/```suggestion\n([\s\S]*?)```/);
    if (suggestionMatch?.[1]?.trim()) return suggestionMatch[1].trim();

    // Typed code blocks after descriptive text
    const codeMatch = body.match(
      /```(?:typescript|javascript|tsx|ts|js)\n([\s\S]*?)```/,
    );
    if (codeMatch?.[1]?.trim()) return codeMatch[1].trim();

    // "Suggested Code:" inside the Prompt for LLM fenced block
    const promptBlock = this._extractPromptBlock(body);
    if (promptBlock) {
      const suggestedIdx = promptBlock.indexOf("Suggested Code:");
      if (suggestedIdx !== -1) {
        const afterMarker = promptBlock
          .slice(suggestedIdx + "Suggested Code:".length)
          .trim();
        if (afterMarker) return afterMarker;
      }
    }

    return null;
  }

  /** Extract raw content from the Prompt for LLM fenced block. */
  private _extractPromptBlock(body: string): string | null {
    const match = body.match(
      /<summary>\s*Prompt for LLM\s*<\/summary>\s*([\s\S]*?)(?=<\/details>)/i,
    );
    if (!match?.[1]) return null;
    const fenced = match[1].match(/```[\s\S]*?\n([\s\S]*?)```/);
    return fenced?.[1]?.trim() ?? match[1].trim();
  }

  parseAiAgentPrompt(body: string): string | null {
    const block = this._extractPromptBlock(body);
    if (!block) return null;
    // Strip the "Suggested Code:" section — that belongs in suggested_fix
    const suggestedIdx = block.indexOf("Suggested Code:");
    if (suggestedIdx !== -1) {
      return block.slice(0, suggestedIdx).trim() || null;
    }
    return block;
  }

  parseConfigNotes(body: string): string | null {
    // Config table from "Code Review Completed" summary
    const tableMatch = body.match(
      /\|.*?Configuration.*?\|[\s\S]*?\|[-\s|]+\|([\s\S]*?)(?=\n\n|\n#|$)/i,
    );
    if (tableMatch?.[0]?.trim()) return tableMatch[0].trim();
    return null;
  }

  parseDisposition(_body: string): string | null {
    return null;
  }

  parseRelatedLocations(body: string): string[] | null {
    // Multi-file listing: * filepath: Lines N-N
    const locations: string[] = [];
    const pattern = /\*\s+([^\s:]+):\s*Lines?\s+(\d+(?:-\d+)?)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      if (match[1] && match[2]) {
        locations.push(`${match[1]}:${match[2]}`);
      }
    }
    return locations.length > 0 ? locations : null;
  }

  explodeSummary(
    _summaryId: string,
    _body: string,
    _file: string | null,
  ): ExplodedComment[] {
    // Kody doesn't embed issues in summary comments
    return [];
  }
}
