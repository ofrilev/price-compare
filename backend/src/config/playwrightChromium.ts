import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

let stealthApplied = false;

/**
 * Chromium with puppeteer-extra-plugin-stealth (helps with Cloudflare / bot checks).
 * Call once per process before launch — `use()` is idempotent for our flag.
 */
export function getStealthChromium(): typeof chromiumExtra {
  if (!stealthApplied) {
    chromiumExtra.use(StealthPlugin());
    stealthApplied = true;
  }
  return chromiumExtra;
}
