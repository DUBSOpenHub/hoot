#!/usr/bin/env node
/**
 * Fetches the current skill + agent + instruction count from
 * github/awesome-copilot and writes it to skill-count.json
 * so the Next.js static build bakes in a fresh number.
 */

const DIRS = ["skills", "agents", "instructions"];
const REPO = "github/awesome-copilot";

async function countDir(dir) {
  const url = `https://api.github.com/repos/${REPO}/contents/${dir}`;
  const headers = { "User-Agent": "hoot-board" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) return 0;
  const items = await res.json();
  return Array.isArray(items) ? items.length : 0;
}

async function main() {
  const counts = await Promise.all(DIRS.map(countDir));
  const total = counts.reduce((a, b) => a + b, 0);
  const data = {
    total,
    skills: counts[0],
    agents: counts[1],
    instructions: counts[2],
    updatedAt: new Date().toISOString(),
  };
  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.default.join(
    path.default.dirname(new URL(import.meta.url).pathname),
    "..",
    "src",
    "app",
    "skill-count.json"
  );
  fs.default.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`✅ skill-count.json updated: ${total} superpowers (${counts[0]} skills, ${counts[1]} agents, ${counts[2]} instructions)`);
}

main().catch((err) => {
  console.error("⚠️  Failed to fetch skill count, keeping existing file:", err.message);
  process.exit(0); // don't fail the build
});
