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
