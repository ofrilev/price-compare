import { writeFile, appendFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, "../../../logs");

async function ensureLogsDir() {
  await mkdir(LOGS_DIR, { recursive: true });
}

function getLogFileName(): string {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  return `llm-${dateStr}.log`;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function formatLogEntry(level: string, data: any): string {
  const timestamp = getTimestamp();
  const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return `[${timestamp}] [${level}] ${dataStr}\n`;
}

export async function logLLMRequest(
  productName: string,
  searchTerm: string,
  sites: Array<{ name: string; baseUrl: string; searchUrl: string }>,
  prompt: string,
  model: string
): Promise<void> {
  await ensureLogsDir();
  const logFile = join(LOGS_DIR, getLogFileName());
  
  const logEntry = formatLogEntry(
    "REQUEST",
    {
      type: "LLM_REQUEST",
      product: {
        name: productName,
        searchTerm,
      },
      sites: sites.map((s) => ({
        name: s.name,
        baseUrl: s.baseUrl,
        searchUrl: s.searchUrl,
      })),
      model,
      prompt,
    }
  );
  
  await appendFile(logFile, logEntry, "utf-8");
  console.log(`[LLM Logger] Request logged for ${productName}`);
}

export async function logLLMResponse(
  productName: string,
  response: any,
  parsedResult: any
): Promise<void> {
  await ensureLogsDir();
  const logFile = join(LOGS_DIR, getLogFileName());
  
  const logEntry = formatLogEntry(
    "RESPONSE",
    {
      type: "LLM_RESPONSE",
      product: productName,
      rawResponse: response.data?.choices?.[0]?.message?.content || response,
      parsedResult,
      usage: response.data?.usage || null,
    }
  );
  
  await appendFile(logFile, logEntry, "utf-8");
  console.log(`[LLM Logger] Response logged for ${productName}`);
}

export async function logLLMError(
  productName: string,
  error: any,
  context?: any
): Promise<void> {
  await ensureLogsDir();
  const logFile = join(LOGS_DIR, getLogFileName());
  
  const logEntry = formatLogEntry(
    "ERROR",
    {
      type: "LLM_ERROR",
      product: productName,
      error: {
        message: error?.message || String(error),
        stack: error?.stack,
        code: error?.code,
        response: error?.response?.data,
      },
      context,
    }
  );
  
  await appendFile(logFile, logEntry, "utf-8");
  console.error(`[LLM Logger] Error logged for ${productName}:`, error.message);
}

export async function logLLMComparisonStart(
  products: Array<{ id: string; name: string }>,
  sites: Array<{ id: string; name: string }>
): Promise<void> {
  await ensureLogsDir();
  const logFile = join(LOGS_DIR, getLogFileName());
  
  const logEntry = formatLogEntry(
    "INFO",
    {
      type: "COMPARISON_START",
      products: products.map((p) => ({ id: p.id, name: p.name })),
      sites: sites.map((s) => ({ id: s.id, name: s.name })),
      timestamp: getTimestamp(),
    }
  );
  
  await appendFile(logFile, logEntry, "utf-8");
  console.log(`[LLM Logger] Comparison started: ${products.length} product(s), ${sites.length} site(s)`);
}

export async function logLLMComparisonEnd(
  results: Array<{ productId: string; siteId: string; price: number | null }>
): Promise<void> {
  await ensureLogsDir();
  const logFile = join(LOGS_DIR, getLogFileName());
  
  const logEntry = formatLogEntry(
    "INFO",
    {
      type: "COMPARISON_END",
      resultsCount: results.length,
      results: results.map((r) => ({
        productId: r.productId,
        siteId: r.siteId,
        price: r.price,
      })),
      timestamp: getTimestamp(),
    }
  );
  
  await appendFile(logFile, logEntry, "utf-8");
  console.log(`[LLM Logger] Comparison completed: ${results.length} result(s)`);
}
