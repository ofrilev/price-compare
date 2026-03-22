import type { LaunchOptions } from "playwright";

const DEFAULT_STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

/**
 * Shared Chromium launch for Docker / Railway + stealth-friendly flags.
 * Use with `getStealthChromium()` from playwright-extra (stealth plugin).
 */
export function getChromiumLaunchOptions(
  overrides?: Partial<LaunchOptions>,
): LaunchOptions {
  const { args: overrideArgs, ...rest } = overrides ?? {};
  return {
    headless: true,
    args: [...DEFAULT_STEALTH_ARGS, ...(overrideArgs ?? [])],
    ...rest,
  };
}

/** Headless in production (e.g. Railway); headed locally unless NODE_ENV is set to production. */
export function playwrightHeadlessForEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}
