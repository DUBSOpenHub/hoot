const TELEGRAM_MAX_LENGTH = 4096;

export function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
    }
    if (splitAt < TELEGRAM_MAX_LENGTH * 0.3) {
      splitAt = TELEGRAM_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

function escapeSegment(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function convertTable(table: string): string {
  const rows = table.trim().split("\n").filter(row => !/^\|[-| :]+\|$/.test(row.trim()));
  const parsed = rows.map(row =>
    row.split("|").map(c => c.trim()).filter(Boolean)
  );
  if (parsed.length === 0) return "";

  const dataRows = parsed.length > 1 ? parsed.slice(1) : parsed;
  return dataRows.map(cols => {
    if (cols.length === 0) return "";
    const first = `*${escapeSegment(cols[0])}*`;
    const rest = cols.slice(1).map(c => escapeSegment(c)).join(" · ");
    return rest ? `${first} — ${rest}` : first;
  }).join("\n");
}

export function toTelegramMarkdown(text: string): string {
  const stash: string[] = [];
  const stashToken = (s: string) => { stash.push(s); return `\x00STASH${stash.length - 1}\x00`; };

  let out = text;

  out = out.replace(/```([a-z]*)\n?([\s\S]*?)```/g, (_m, lang, code) =>
    stashToken("```" + (lang || "") + "\n" + code.trim() + "\n```")
  );

  out = out.replace(/`([^`\n]+)`/g, (_m, code) =>
    stashToken("`" + code + "`")
  );

  out = out.replace(/(?:^\|.+\|[ \t]*$\n?)+/gm, (table) =>
    stashToken(convertTable(table) + "\n")
  );

  out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, title) => `**${title.trim()}**`);

  out = out.replace(/^[-*_]{3,}\s*$/gm, "");

  const boldParts: string[] = [];
  out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner) => {
    boldParts.push(inner);
    return `\x00BOLD${boldParts.length - 1}\x00`;
  });

  const italicParts: string[] = [];
  out = out.replace(/\*(.+?)\*/g, (_m, inner) => {
    italicParts.push(inner);
    return `\x00ITALIC${italicParts.length - 1}\x00`;
  });

  out = escapeSegment(out);

  out = out.replace(/\x00BOLD(\d+)\x00/g, (_m, i) => `*${escapeSegment(boldParts[+i])}*`);
  out = out.replace(/\x00ITALIC(\d+)\x00/g, (_m, i) => `_${escapeSegment(italicParts[+i])}_`);

  out = out.replace(/\x00STASH(\d+)\x00/g, (_m, i) => stash[+i]);

  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}
