import type { LaunchOptions } from "playwright";

/**
 * Shared Chromium launch for Docker / Railway:
 * - `headless: true` by default (override via `overrides` or `NODE_ENV !== "production"` callers)
 * - `--disable-dev-shm-usage` avoids OOM / crashes when /dev/shm is small in containers
 */
export function getChromiumLaunchOptions(
  overrides?: Partial<LaunchOptions>,
): LaunchOptions {
  const { args: overrideArgs, ...rest } = overrides ?? {};
  return {
    headless: true,
    args: ["--disable-dev-shm-usage", ...(overrideArgs ?? [])],
    ...rest,
  };
}

/** Headless in production (e.g. Railway); headed locally unless NODE_ENV is set to production. */
export function playwrightHeadlessForEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}
