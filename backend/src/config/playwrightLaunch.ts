import type { LaunchOptions } from "playwright";

/**
 * Shared Chromium launch options for Docker / Railway (avoids /dev/shm exhaustion).
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
