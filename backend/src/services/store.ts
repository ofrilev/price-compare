import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, "../../../data");

/** Lazy so callers (e.g. setup-user) can set process.env.DATA_DIR before first I/O */
export function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

async function ensureDataDir() {
  await mkdir(getDataDir(), { recursive: true });
}

export async function readJson<T>(filename: string): Promise<T> {
  await ensureDataDir();
  const path = join(getDataDir(), filename);
  try {
    const content = await readFile(path, "utf-8");
    const trimmed = content.trim();
    if (!trimmed) return [] as T;
    return JSON.parse(content) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [] as T;
    }
    if (err instanceof SyntaxError) {
      // Corrupted JSON - return empty array for list files
      if (["products.json", "results.json", "sites.json"].includes(filename)) {
        return [] as T;
      }
    }
    throw err;
  }
}

export async function writeJson<T>(filename: string, data: T): Promise<void> {
  await ensureDataDir();
  const path = join(getDataDir(), filename);
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}
