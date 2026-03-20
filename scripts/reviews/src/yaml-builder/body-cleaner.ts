// ---------------------------------------------------------------------------
// HTML stripping and boilerplate removal
// ---------------------------------------------------------------------------

/** Remove <details>, <summary>, and <blockquote> tags but keep inner content. */
export function stripCollapseWrappers(body: string): string {
  return body
    .replace(/<\/?details[^>]*>/gi, "")
    .replace(/<\/?summary[^>]*>/gi, "")
    .replace(/<\/?blockquote[^>]*>/gi, "");
}

/**
 * Remove reviewer-specific boilerplate signatures and footers.
 *
 * @bot-specific: Each bot appends signature/tip blocks that are noise for analysis.
 * Unknown reviewers (including humans) skip this step — only HTML wrappers
 * and blank lines are cleaned for them.
 * Verify: check recent reviews from each bot for footer format changes.
 */
export function stripBoilerplate(body: string, reviewerName: string): string {
  let cleaned = body;

  // @bot-specific(coderabbit): Tips block, footer, and HTML comment format
  // Verify: check a recent CodeRabbit review for changes to these patterns
  if (reviewerName === "coderabbitai") {
    cleaned = cleaned.replace(
      /---\s*<details>\s*<summary>.*?Tips.*?<\/summary>[\s\S]*?<\/details>/gi,
      "",
    );
    cleaned = cleaned.replace(
      /\n*---\n*Thank you for using CodeRabbit[\s\S]*$/i,
      "",
    );
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  }

  // @bot-specific(kody): Talk-to-Kody footer, signature lines, and HTML comments
  // Verify: check a recent Kody review for changes to these patterns
  if (reviewerName === "kody-ai") {
    cleaned = cleaned.replace(
      /\n*---\n*\[Talk to Kody\][\s\S]*$/i,
      "",
    );
    cleaned = cleaned.replace(/\n*---\n*\*\*Kody\*\*.*$/gim, "");
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  }

  return cleaned.trim();
}

/**
 * Combined cleaning pipeline.
 *
 * IMPORTANT: Extract structured fields (suggested_fix, ai_agent_prompt)
 * BEFORE calling this function, since cleaning strips the delimiters.
 */
export function cleanBody(body: string, reviewerName: string): string {
  let cleaned = stripBoilerplate(body, reviewerName);
  cleaned = stripCollapseWrappers(cleaned);
  // Collapse excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}
