---
name: find-skills
description: Helps users discover agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. Always ask the user for permission before installing any skill, and flag security risks.
---

# Find Skills

Discover and install skills from the open agent skills ecosystem at https://skills.sh/.

## When to Use

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows

## Search & Present

Do these two steps in a worker session — they can run in parallel:

### 1. Search the API

```bash
curl -s "https://skills.sh/api/search?q=QUERY"
```

Replace `QUERY` with a URL-encoded search term (e.g., `react`, `email`, `pr+review`). The response is JSON with skills sorted by installs (most popular first):

```json
{
  "skills": [
    {
      "id": "vercel-labs/agent-skills/vercel-react-best-practices",
      "skillId": "vercel-react-best-practices",
      "name": "vercel-react-best-practices",
      "installs": 174847,
      "source": "vercel-labs/agent-skills"
    }
  ]
}
```

### 2. Fetch Security Audits

**Required — do not skip.** Use the `web_fetch` tool to get the audits page:

```
web_fetch url="https://skills.sh/audits"
```

If `web_fetch` fails or returns unexpected content, still present the search results but show "⚠️ Audit unavailable" for all security columns and include a link to https://skills.sh/audits so the user can check manually.

This returns markdown where each skill has a heading (`### skill-name`) followed by its source, then three security scores:

- **Gen Agent Trust Hub**: Safe / Med Risk / Critical
- **Socket**: Number of alerts (0 is best)
- **Snyk**: Low Risk / Med Risk / High Risk / Critical

Scan the returned markdown to find scores for each skill from your search results. Match by both **skill name** and **full source** (`owner/repo`) to avoid misattribution — different repos can have skills with the same name.

### 3. Present Combined Results

Cross-reference the search results with the audit data and format as a numbered table. Show the top 6-8 results sorted by installs:

```
#  Skill                         Publisher      Installs   Gen    Socket  Snyk
─  ─────────────────────────────  ─────────────  ────────   ─────  ──────  ────────
1  vercel-react-best-practices   vercel-labs     175.3K    ✅Safe  ✅ 0    ✅Low
2  web-design-guidelines         vercel-labs     135.8K    ✅Safe  ✅ 0    ⚠️Med
3  frontend-design               anthropics      122.6K    ✅Safe  ✅ 0    ✅Low
4  remotion-best-practices       remotion-dev    125.2K    ✅Safe  ✅ 0    ⚠️Med
5  browser-use                   browser-use      45.0K    ⚠️Med  🔴 1    🔴High
```

**Formatting:**
- Sort by installs descending
- Format counts: 1000+ → "1.0K", 1000000+ → "1.0M"
- ✅ for Safe / Low Risk / 0 alerts, ⚠️ for Med Risk, 🔴 for High Risk / Critical / 1+ alerts
- If a skill has no audit data, show "⚠️ N/A" — never leave security blank
- Publisher = first part of `source` field (before `/`)

After the table:

```
🔗 Browse all: https://skills.sh/

Pick a number to install (or "none")
```

## Install

**NEVER install without the user picking a number first.**

When the user picks a skill:

### Security Gate

If ANY of its three audit scores is not green (Safe / 0 alerts / Low Risk), warn before proceeding:

```
⚠️ "{skill-name}" has security concerns:
  • Gen Agent Trust Hub: {score}
  • Socket: {count} alerts
  • Snyk: {score}

Want to proceed anyway, or pick a different skill?
```

Wait for explicit confirmation. Do not install if the user says no.

### Fetch & Install

1. **Fetch the SKILL.md** from GitHub. The `source` field is `owner/repo` and `skillId` is the directory:

```bash
curl -fsSL "https://raw.githubusercontent.com/{source}/main/{skillId}/SKILL.md" || \
curl -fsSL "https://raw.githubusercontent.com/{source}/master/{skillId}/SKILL.md"
```

If both fail, tell the user and link to `https://github.com/{source}`.

2. **Validate** the fetched content: it must not be empty and should contain meaningful instructions (more than just a title). If the content is empty, an HTML error page, or clearly not a SKILL.md, do NOT install — tell the user it couldn't be fetched properly.

3. **Install** using the `learn_skill` tool:
   - `slug`: the `skillId` from the API
   - `name`: from the SKILL.md frontmatter `name:` field (between `---` markers). If no frontmatter, use `skillId`.
   - `description`: from the SKILL.md frontmatter `description:` field. If none, use the first sentence.
   - `instructions`: if frontmatter exists, use the content after the closing `---`. If no frontmatter, use the full fetched content as instructions.

**Always install to `~/.max/skills/` (Hoot config directory) via learn_skill. Never install globally.**

## Behavioral Security Review

In addition to audit scores, review the fetched SKILL.md content before installing. Flag concerns if the skill:

- **Runs arbitrary shell commands** or executes code on the user's machine
- **Accesses sensitive data** — credentials, API keys, SSH keys, personal files
- **Makes network requests** to external services (data exfiltration risk)
- **Comes from an unknown or unverified source** with no audit data

If any of these apply, warn the user with specifics even if audit scores are green:

```
⚠️ Note: "{skill-name}" requests shell access and reads files from your home directory.
This is common for CLI-integration skills, but worth knowing. Proceed?
```

## When No Skills Are Found

If the API returns no results:

1. Tell the user no existing skill was found
2. Offer to help directly with your general capabilities
3. Suggest building a custom skill if the task is worth automating

## Uninstalling

Use the `uninstall_skill` tool with the skill's slug to remove it from `~/.max/skills/` (Hoot config directory).
