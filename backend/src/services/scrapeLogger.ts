import { appendFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRAPE_LOGS_DIR = join(__dirname, "../../../logs/scrape-logs");

async function ensureDir() {
  await mkdir(SCRAPE_LOGS_DIR, { recursive: true });
}

function getLogFileName(): string {
  const dateStr = new Date().toISOString().split("T")[0];
  return `scrape-${dateStr}.log`;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format OpenAI `chat.completions` usage (and similar) for scrape log lines.
 */
export function formatLlmTokenUsage(usage: unknown): string {
  if (!usage || typeof usage !== "object") return "";
  const u = usage as Record<string, unknown>;
  const parts: string[] = [];
  const p = u.prompt_tokens;
  const c = u.completion_tokens;
  const t = u.total_tokens;
  if (typeof p === "number") parts.push(`prompt=${p}`);
  if (typeof c === "number") parts.push(`completion=${c}`);
  if (typeof t === "number") parts.push(`total=${t}`);
  const pt = u.prompt_tokens_details;
  if (pt && typeof pt === "object") {
    const cached = (pt as Record<string, unknown>).cached_tokens;
    if (typeof cached === "number" && cached > 0) parts.push(`cached=${cached}`);
  }
  const cd = u.completion_tokens_details;
  if (cd && typeof cd === "object") {
    const rt = (cd as Record<string, unknown>).reasoning_tokens;
    if (typeof rt === "number") parts.push(`reasoning=${rt}`);
  }
  return parts.length ? parts.join(", ") : "";
}

/** Append token usage to a scrape log message when the API returned usage stats. */
export function appendLlmTokenUsage(message: string, usage: unknown): string {
  const tok = formatLlmTokenUsage(usage);
  return tok ? `${message} | ${tok}` : message;
}

let logFilePromise: Promise<string> | null = null;

async function getLogFile(): Promise<string> {
  if (!logFilePromise) {
    logFilePromise = (async () => {
      await ensureDir();
      return join(SCRAPE_LOGS_DIR, getLogFileName());
    })();
  }
  return logFilePromise;
}

/**
 * Log a scrape step. Writes to logs/scrape-logs/scrape-YYYY-MM-DD.log and console.
 */
export async function logScrape(message: string): Promise<void> {
  const timestamp = getTimestamp();
  const line = `[${timestamp}] [Scrape] ${message}\n`;

  console.log(`[Scrape] ${message}`);

  try {
    const logFile = await getLogFile();
    await appendFile(logFile, line, "utf-8");
  } catch (err) {
    console.error("[Scrape Logger] Failed to write to file:", err);
  }
}

/**
 * Log a scrape error. Writes to same log file with ERROR prefix.
 */
export async function logScrapeError(message: string, err?: unknown): Promise<void> {
  const timestamp = getTimestamp();
  const errStr = err ? `: ${err instanceof Error ? err.message : String(err)}` : "";
  const line = `[${timestamp}] [Scrape] [ERROR] ${message}${errStr}\n`;

  console.error(`[Scrape] ${message}`, err ?? "");

  try {
    const logFile = await getLogFile();
    await appendFile(logFile, line, "utf-8");
  } catch (e) {
    console.error("[Scrape Logger] Failed to write to file:", e);
  }
}
