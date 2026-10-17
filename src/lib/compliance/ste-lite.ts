// STE-lite (TASK-3165): the measurable part of ASD-STE100, the controlled
// language written for aircraft maintenance manuals. A deterministic check, not
// a model's opinion, so the gate is predictable. Sentence and paragraph length
// can block; passive voice is advice only, because a word-pattern check for it
// has false positives. Code, URLs, file paths and IDs count as one word each;
// a markdown link's visible text counts normally, because a person reads it.
// Each sentence in a numbered step has its own 20-word limit, as in ASD-STE100.
// Headings and table rows are skipped: they hold labels and data, not sentences.

export const STE_LITE_LIMITS = {
  /** A numbered step: one instruction. */
  stepWords: 20,
  /** Any other sentence. */
  sentenceWords: 25,
  /** Sentences in one prose paragraph. */
  paragraphSentences: 6,
} as const;

export interface WritingFinding {
  rule: "step-length" | "sentence-length" | "paragraph-length" | "passive-voice";
  /** An error counts toward the gate; advice never blocks. */
  severity: "error" | "advice";
  message: string;
}

const STEP = /^\s*\d+[.)]\s+/;
const BULLET = /^\s*[-*+]\s+/;
const QUOTE = /^\s*>\s?/;
const SKIPPED_LINE = /^\s*(#|\||---)/;
// be + an optional -ly adverb + a word; the word decides (isParticiple).
const BE_WORD = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+)\b/gi;
const IRREGULAR_PARTICIPLES = new Set(["made", "done", "set", "sent", "built", "kept", "held", "run", "shown", "known", "given", "taken", "written", "put", "read"]);
const NOT_PARTICIPLES = new Set(["open", "green", "often", "even", "red", "need", "seed", "feed", "speed", "indeed", "embed", "hundred", "token", "sudden", "golden"]);

const isParticiple = (word: string): boolean =>
  IRREGULAR_PARTICIPLES.has(word) || (word.length > 3 && /(?:ed|en)$/.test(word) && !NOT_PARTICIPLES.has(word));

const isPassive = (sentence: string): boolean =>
  [...sentence.matchAll(BE_WORD)].some((match) => isParticiple(match[1].toLowerCase()));

/** Remove what STE-lite does not judge: code blocks; code, links and URLs become one word. */
function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`[^`\n]*`/g, "X")
    // A URL keeps the punctuation after it, so a full stop still ends the sentence.
    .replace(/\bhttps?:\/\/\S*[^\s.,;:!?)\]'"]/g, "X")
    // Mid-sentence abbreviations only; "etc." usually ends a sentence, so it stays.
    .replace(/\b(?:e\.g|i\.e|vs|approx)\./gi, (abbr) => abbr.replace(/\./g, ""));
}

const words = (sentence: string): string[] => sentence.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => words(sentence).length > 0);

const excerpt = (sentence: string): string => {
  const head = words(sentence).slice(0, 8).join(" ");
  return words(sentence).length > 8 ? `"${head} …"` : `"${head}"`;
};

interface ListUnit {
  text: string;
  step: boolean;
}

/** Each STE-lite finding in `text`, paragraph by paragraph. */
export function steLiteFindings(text: string): WritingFinding[] {
  const findings: WritingFinding[] = [];
  const check = (sentence: string, step: boolean) => {
    const limit = step ? STE_LITE_LIMITS.stepWords : STE_LITE_LIMITS.sentenceWords;
    const count = words(sentence).length;
    if (count > limit) {
      findings.push({
        rule: step ? "step-length" : "sentence-length",
        severity: "error",
        message: `${step ? "Step" : "Sentence"} has ${count} words. Limit: ${limit}. ${excerpt(sentence)}`,
      });
    }
    if (isPassive(sentence)) {
      findings.push({ rule: "passive-voice", severity: "advice", message: `Use the active voice. ${excerpt(sentence)}` });
    }
  };

  for (const paragraph of plainText(text).split(/\n\s*\n/)) {
    const prose: string[] = [];
    const units: ListUnit[] = [];
    // After a line that ends with ":", plain lines are list items (paths, commands).
    let listFollows = false;
    for (const raw of paragraph.split("\n")) {
      const line = raw.replace(QUOTE, "");
      if (!line.trim() || SKIPPED_LINE.test(line)) continue;
      const last = units.at(-1);
      if (STEP.test(line)) units.push({ text: line.replace(STEP, ""), step: true });
      else if (BULLET.test(line)) units.push({ text: line.replace(BULLET, ""), step: false });
      // An indented line continues the step or bullet above it.
      else if (last && /^\s/.test(line)) last.text += ` ${line.trim()}`;
      else if (listFollows || words(line).length === 1) units.push({ text: line, step: false });
      else {
        prose.push(line);
        listFollows = /:\s*$/.test(line);
      }
    }
    for (const unit of units) for (const sentence of sentences(unit.text)) check(sentence, unit.step);
    const proseSentences = sentences(prose.join(" "));
    for (const sentence of proseSentences) check(sentence, false);
    if (proseSentences.length > STE_LITE_LIMITS.paragraphSentences) {
      findings.push({
        rule: "paragraph-length",
        severity: "error",
        message: `Paragraph has ${proseSentences.length} sentences. Limit: ${STE_LITE_LIMITS.paragraphSentences}. ${excerpt(proseSentences[0])}`,
      });
    }
  }
  return findings;
}
