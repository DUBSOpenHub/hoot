import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createLogger } from "../observability/logger.js";
import { getSkillDirectories } from "./skills.js";

const log = createLogger("skill-loader");

interface SkillLookupEntry {
  slug: string;
  directory: string;
  name: string;
  description: string;
  phrases: string[];
  terms: string[];
}

let indexedRootSignature = "";
let indexedEntries: SkillLookupEntry[] = [];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return Array.from(new Set(
    normalize(text)
      .split(/[\s-]+/)
      .filter((token) => token.length >= 3)
  ));
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: "", description: "" };

  let name = "";
  let description = "";
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (key === "name") name = value;
    if (key === "description") description = value;
  }
  return { name, description };
}

function extractTriggerPhrases(content: string, slug: string, name: string, description: string): string[] {
  const phrases = new Set<string>();
  const addPhrase = (value?: string) => {
    if (!value) return;
    const normalized = normalize(value);
    if (normalized.length >= 3) phrases.add(normalized);
  };

  addPhrase(slug.replace(/-/g, " "));
  addPhrase(name);

  const quotedPhrasePatterns = [
    /say\s+["“](.+?)["”]\s+to\s+start/gi,
    /type\s+["“](.+?)["”]/gi,
    /trigger(?: phrase)?\s*[:=-]\s*(.+)$/gim,
  ];

  for (const pattern of quotedPhrasePatterns) {
    for (const match of content.matchAll(pattern)) {
      addPhrase(match[1]);
    }
  }

  const descriptionBits = description
    .split(/[.!?]|\bor\b/)
    .map((part) => normalize(part))
    .filter((part) => part.length >= 4 && part.length <= 80);
  for (const bit of descriptionBits) addPhrase(bit);

  return Array.from(phrases);
}

function buildEntry(skillDir: string, slug: string): SkillLookupEntry | undefined {
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) return undefined;

  try {
    const content = readFileSync(skillMd, "utf8");
    const { name, description } = parseFrontmatter(content);
    const phrases = extractTriggerPhrases(content, slug, name || slug, description || "");
    const terms = Array.from(new Set([
      ...tokenize(slug.replace(/-/g, " ")),
      ...tokenize(name || slug),
      ...tokenize(description || ""),
      ...phrases.flatMap((phrase) => tokenize(phrase)),
    ]));

    return {
      slug,
      directory: skillDir,
      name: name || slug,
      description: description || "",
      phrases,
      terms,
    };
  } catch (err) {
    log.warn("Failed to index skill", { skillDir, err: String(err) });
    return {
      slug,
      directory: skillDir,
      name: slug,
      description: "",
      phrases: [normalize(slug.replace(/-/g, " "))],
      terms: tokenize(slug.replace(/-/g, " ")),
    };
  }
}

function indexSkills(skillRoots: string[]): SkillLookupEntry[] {
  const entries: SkillLookupEntry[] = [];

  for (const root of skillRoots) {
    if (!existsSync(root)) continue;
    for (const slug of readdirSync(root)) {
      const entry = buildEntry(join(root, slug), slug);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

export function initializeSkillLoader(skillRoots = getSkillDirectories()): void {
  const signature = skillRoots.join("|");
  if (signature === indexedRootSignature && indexedEntries.length > 0) return;
  indexedEntries = indexSkills(skillRoots);
  indexedRootSignature = signature;
  log.info("Indexed skills", { count: indexedEntries.length });
}

export function resetSkillLoader(): void {
  indexedRootSignature = "";
  indexedEntries = [];
}

export function selectRelevantSkillDirectories(message: string, maxMatches = 5): string[] {
  const skillRoots = getSkillDirectories();
  initializeSkillLoader(skillRoots);

  if (indexedEntries.length === 0) return skillRoots;

  const normalizedMessage = normalize(message);
  const messageTerms = new Set(tokenize(message));

  const scored = indexedEntries
    .map((entry) => {
      let score = 0;

      for (const phrase of entry.phrases) {
        if (!phrase) continue;
        if (normalizedMessage.includes(phrase)) {
          score += Math.max(6, phrase.split(" ").length * 3);
        }
      }

      for (const term of entry.terms) {
        if (messageTerms.has(term)) score += 1;
      }

      return { entry, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.slug.localeCompare(b.entry.slug));

  if (scored.length === 0) {
    return indexedEntries.map((entry) => entry.directory);
  }

  return Array.from(new Set(scored.slice(0, maxMatches).map((candidate) => candidate.entry.directory)));
}
