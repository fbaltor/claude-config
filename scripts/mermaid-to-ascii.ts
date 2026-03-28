/**
 * Converts mermaid code blocks in a markdown file to ASCII/Unicode diagrams.
 *
 * Usage:
 *   npx tsx ~/.claude/scripts/mermaid-to-ascii.ts <file.md>           # print ASCII to stdout
 *   npx tsx ~/.claude/scripts/mermaid-to-ascii.ts <file.md> --write   # rewrite file in-place
 *
 * Behavior:
 *   - Extracts all ```mermaid blocks from the markdown file
 *   - Converts each to Unicode box-drawing art via beautiful-mermaid
 *   - In --write mode: replaces ```mermaid blocks with ``` (ASCII output),
 *     appends original mermaid source as an appendix at the end of the file
 *   - Without --write: prints each diagram's ASCII to stdout (for preview)
 */

import { readFileSync, writeFileSync } from "fs";
import { renderMermaidASCII } from "beautiful-mermaid";

const filePath = process.argv[2];
const writeMode = process.argv.includes("--write");

if (!filePath) {
  console.error(
    "Usage: npx tsx ~/.claude/scripts/mermaid-to-ascii.ts <file.md> [--write]"
  );
  process.exit(1);
}

const md = readFileSync(filePath, "utf-8");
const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;

interface DiagramResult {
  index: number;
  mermaidSource: string;
  ascii: string | null;
  error: string | null;
}

const results: DiagramResult[] = [];
let match: RegExpExecArray | null;
let i = 0;

while ((match = mermaidRegex.exec(md)) !== null) {
  const source = match[1]!.trim();
  i++;
  try {
    const ascii = renderMermaidASCII(source, { useAscii: false });
    results.push({ index: i, mermaidSource: source, ascii, error: null });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    results.push({ index: i, mermaidSource: source, ascii: null, error: errMsg });
  }
}

if (results.length === 0) {
  console.error("No ```mermaid blocks found in the file.");
  process.exit(1);
}

if (!writeMode) {
  // Preview mode: print each diagram
  for (const r of results) {
    console.log(`\n=== Diagram ${r.index} ===\n`);
    if (r.ascii) {
      console.log(r.ascii);
    } else {
      console.log(`ERROR: ${r.error}`);
      console.log(`\nRaw mermaid:\n${r.mermaidSource}`);
    }
  }
  process.exit(0);
}

// Write mode: replace mermaid blocks with ASCII, append mermaid source as appendix
let output = md;
let diagramNum = 0;

output = output.replace(mermaidRegex, (fullMatch, mermaidContent: string) => {
  const r = results[diagramNum]!;
  diagramNum++;
  if (r.ascii) {
    return "```\n" + r.ascii + "\n```";
  }
  // If conversion failed, keep the original mermaid block
  console.error(`Warning: Diagram ${r.index} failed to convert: ${r.error}`);
  return fullMatch;
});

// Append mermaid source appendix
const successfulDiagrams = results.filter((r) => r.ascii !== null);
if (successfulDiagrams.length > 0) {
  output += "\n---\n\n## Appendix: Mermaid Diagram Source\n\n";
  output +=
    "> The ASCII diagrams above were generated from these mermaid definitions using `beautiful-mermaid`.\n";
  output +=
    "> To regenerate: `npx tsx ~/.claude/scripts/mermaid-to-ascii.ts <file.md> --write`\n\n";

  for (const r of successfulDiagrams) {
    output += `### Diagram ${r.index}\n\n`;
    output += "```mermaid\n" + r.mermaidSource + "\n```\n\n";
  }
}

writeFileSync(filePath, output, "utf-8");
console.log(
  `Converted ${successfulDiagrams.length}/${results.length} diagrams. File updated: ${filePath}`
);
