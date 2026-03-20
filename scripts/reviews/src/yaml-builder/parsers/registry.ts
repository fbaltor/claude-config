import type { BotParser } from "../types.js";
import { CodeRabbitParser } from "./coderabbit.js";
import { KodyParser } from "./kody.js";

/**
 * @bot-specific: Parser dispatch keyed by reviewer login (post getAuthorName stripping).
 * Reviewers not in this registry get NULL_PARSER (all structured fields null, body uncleaned).
 * To add a bot: create a BotParser implementation and register it here.
 *
 * Bots that intentionally use NULL_PARSER (plain text, no structured output):
 * - copilot-pull-request-reviewer  @bot-specific(copilot)
 */
const parsers: Record<string, BotParser> = {
  coderabbitai: new CodeRabbitParser(), // @bot-specific(coderabbit)
  "kody-ai": new KodyParser(),         // @bot-specific(kody)
};

export function getParser(reviewerName: string): BotParser | null {
  return parsers[reviewerName] ?? null;
}
