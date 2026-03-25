import axios from "axios";
import { mkdir, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Locator, Page } from "playwright";
import type { Site } from "../types.js";
import {
  findSiteByZapRetailerLabel,
  hostnameLooksLikeZap,
  normalizeHost,
} from "../config/zapSite.js";
import { appendLlmTokenUsage, logScrape, logScrapeError } from "./scrapeLogger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZAP_DEBUG_DIR = join(__dirname, "../../../data/navigator-zap-debug");

const ZAP_GOTO_TIMEOUT_MS = 15_000;
const ZAP_RESULTS_TIMEOUT_MS = 25_000;
const ZAP_LLM_DEFAULT_MAX_CHARS = 14_000;
const ZAP_LLM_TIMEOUT_MS = 25_000;

/** When `#divSearchResults` is empty (e.g. `model.aspx`), compare rows often live under `main`. */
const ZAP_SCOPE_DEFAULT_FALLBACKS = ["main", "#content", "#contents", "body"];

/** Set `ZAP_DEBUG_SCREENSHOTS=0` to skip writing PNG/txt under data/navigator-zap-debug/ */
function zapDebugArtifactsDisabled(): boolean {
  const v = process.env.ZAP_DEBUG_SCREENSHOTS?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

/**
 * On empty extract or errors: viewport + full-page PNG, optional results-node PNG, and a .txt snapshot meta.
 */
async function saveZapDebugArtifacts(
  page: Page,
  resultsRoot: Locator,
  query: string,
  reason: string,
): Promise<void> {
  if (zapDebugArtifactsDisabled()) return;

  try {
    await mkdir(ZAP_DEBUG_DIR, { recursive: true });
  } catch {
    return;
  }

  const safe =
    query
      .replace(/[^\w\u0590-\u05FF-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || "query";
  const ts = Date.now();
  const base = join(ZAP_DEBUG_DIR, `zap-${ts}-${safe}`);

  const paths: string[] = [];
  const innerFull = await resultsRoot.innerText().catch(() => "");
  const visible = await resultsRoot.isVisible().catch(() => false);

  await page.screenshot({ path: `${base}-viewport.png`, fullPage: false }).then(
    () => paths.push(`${base}-viewport.png`),
    () => null,
  );
  await page.screenshot({ path: `${base}-fullpage.png`, fullPage: true }).then(
    () => paths.push(`${base}-fullpage.png`),
    () => null,
  );
  if (visible) {
    await resultsRoot.screenshot({ path: `${base}-results-node.png` }).then(
      () => paths.push(`${base}-results-node.png`),
      () => null,
    );
  }

  const meta = [
    `reason: ${reason}`,
    `query: ${query}`,
    `page_url: ${page.url()}`,
    `results_selector_visible: ${visible}`,
    `results_innerText_length: ${innerFull.length}`,
    "",
    "--- results innerText (first 4000 chars) ---",
    innerFull.slice(0, 4000),
  ].join("\n");

  try {
    await writeFile(`${base}.txt`, meta, "utf8");
    paths.push(`${base}.txt`);
  } catch {
    /* ignore */
  }

  if (paths.length) {
    await logScrape(
      `Zap: debug artifacts in data/navigator-zap-debug/: ${paths.map((p) => basename(p)).join(", ")}`,
    );
  }
}

export type ZapRawOffer = {
  price: number;
  productUrl: string;
  hostname: string;
};

/** Evaluated in the browser as a string so tsx never injects `__name` into `page.evaluate`. */
const ZAP_DIALOG_CORNER_CLOSE_JS = `(function(){
  var roots = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="Modal" i], [class*="popup" i], [class*="Popup" i]');
  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    var dr = root.getBoundingClientRect();
    if (dr.width < 80 || dr.height < 80) continue;
    var style = window.getComputedStyle(root);
    if (style.display === "none" || style.visibility === "hidden") continue;
    var nodes = root.querySelectorAll("button, a");
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var br = node.getBoundingClientRect();
      if (br.width < 6 || br.height < 6 || br.width > 80 || br.height > 80) continue;
      if (br.top <= dr.top + 88 && br.right >= dr.right - 88) {
        node.click();
        return true;
      }
    }
  }
  return false;
})()`;

const DEFAULT_ZAP_MODAL_DISMISS_SELECTORS = [
  'div[role="dialog"] button[aria-label*="close" i]',
  'div[role="dialog"] button[aria-label*="סגור"]',
  '[class*="modal" i] button[class*="close" i]',
  '[class*="Modal"] button[class*="Close"]',
  'button[aria-label="סגור"]',
  'button[aria-label="Close"]',
  '[data-dismiss="modal"]',
  ".modal .close",
];

/**
 * Close lottery / promo overlays (e.g. DREAME popup) that block #divSearchResults.
 */
async function dismissZapOverlayModals(page: Page, site: Site): Promise<void> {
  const custom = site.scraperConfig?.zapModalDismissSelectors?.filter(Boolean) ?? [];
  const selectors = [...custom, ...DEFAULT_ZAP_MODAL_DISMISS_SELECTORS];

  for (let round = 0; round < 3; round++) {
    await page.keyboard.press("Escape").catch(() => null);
    await new Promise((r) => setTimeout(r, 200));

    try {
      await page.evaluate(ZAP_DIALOG_CORNER_CLOSE_JS);
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 150));

    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      const vis = await loc.isVisible().catch(() => false);
      if (vis) {
        await loc.click({ timeout: 2000, force: true }).catch(() => null);
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    try {
      const closeRole = page.getByRole("button", { name: /^(×|✕|X|סגור|Close)$/i });
      if (await closeRole.first().isVisible({ timeout: 400 }).catch(() => false)) {
        await closeRole.first().click({ timeout: 2000, force: true }).catch(() => null);
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch {
      /* ignore */
    }
  }
}

async function runZapPreSteps(page: Page, site: Site): Promise<void> {
  const cfg = site.scraperConfig;
  if (!cfg?.preSteps?.length) return;
  for (const step of cfg.preSteps) {
    if (step.type === "click" && step.selector) {
      await page.locator(step.selector).first().click({ timeout: 5000 }).catch(() => null);
    }
    if (step.type === "scroll") {
      await page.evaluate(() => window.scrollBy(0, 300));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

function buildZapDomExtractFn() {
  return new Function(
    "args",
    `
      var containerSelector = args.containerSelector;
      var maxN = args.maxN;
      var container = document.querySelector(containerSelector);
      if (!container) return [];
      function isZapUrl(href) {
        try {
          var h = new URL(href).hostname.toLowerCase();
          return h === "zap.co.il" || h.endsWith(".zap.co.il");
        } catch (e) {
          return /zap\\.co\\.il/i.test(href);
        }
      }
      function parsePriceFromText(text) {
        var cleaned = text.replace(/[\u200f\u200e]/g, "").replace(/\\s+/g, " ");
        var patterns = [
          /(?:₪|ש"ח)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:₪)?/g,
          /([\\d,]+(?:\\.\\d+)?)\\s*₪/g
        ];
        var best = null;
        for (var pi = 0; pi < patterns.length; pi++) {
          var re = patterns[pi];
          var m;
          var r = new RegExp(re.source, re.flags);
          while ((m = r.exec(cleaned)) !== null) {
            var raw = m[1].replace(/,/g, "");
            var n = parseFloat(raw);
            if (Number.isFinite(n) && n >= 1 && n < 2000000) {
              var intPrice = Math.round(n);
              if (best === null || intPrice < best) best = intPrice;
            }
          }
        }
        return best;
      }
      var anchors = Array.prototype.slice.call(
        container.querySelectorAll('a[href^="http"], a[href^="//"]')
      );
      var candidates = [];
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = a.href;
        if (!href || href.indexOf("javascript:") === 0) continue;
        var abs = href;
        if (abs.indexOf("//") === 0) abs = "https:" + abs;
        if (isZapUrl(abs)) continue;
        var hostname = "";
        try {
          hostname = new URL(abs).hostname.toLowerCase();
        } catch (e) {
          continue;
        }
        if (!hostname) continue;
        var price = null;
        var el = a;
        for (var depth = 0; depth < 12 && el; depth++) {
          price = parsePriceFromText((el.textContent || "").trim());
          if (price !== null) break;
          el = el.parentElement;
        }
        if (price === null) continue;
        candidates.push({ price: price, productUrl: abs, hostname: hostname });
      }
      var seenHosts = {};
      var out = [];
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        var h = c.hostname;
        if (h.indexOf("www.") === 0) h = h.slice(4);
        if (seenHosts[h]) continue;
        seenHosts[h] = true;
        out.push({ price: c.price, productUrl: c.productUrl, hostname: h });
        if (out.length >= maxN) break;
      }
      return out;
      `,
  ) as (args: { containerSelector: string; maxN: number }) => ZapRawOffer[];
}

async function resolveZapExtractionScope(
  page: Page,
  cfg: Site["scraperConfig"] | undefined,
): Promise<{ root: Locator; selector: string }> {
  const primary = cfg?.zapResultsContainerSelector?.trim() || "#divSearchResults";
  const fromConfig = cfg?.zapResultsFallbackSelectors ?? [];
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const s of [primary, ...fromConfig, ...ZAP_SCOPE_DEFAULT_FALLBACKS]) {
    const sel = s?.trim();
    if (!sel || seen.has(sel)) continue;
    seen.add(sel);
    chain.push(sel);
  }

  let best: { root: Locator; selector: string; len: number } | null = null;
  for (const sel of chain) {
    const root = page.locator(sel).first();
    const vis = await root.isVisible().catch(() => false);
    if (!vis) continue;
    const txt = (await root.innerText().catch(() => "")).trim().length;
    if (txt > (best?.len ?? -1)) best = { root, selector: sel, len: txt };
  }
  if (best && best.len >= 80) {
    return { root: best.root, selector: best.selector };
  }
  if (best && best.len >= 1) {
    return { root: best.root, selector: best.selector };
  }
  for (const sel of chain) {
    const root = page.locator(sel).first();
    if (await root.isVisible().catch(() => false)) return { root, selector: sel };
  }
  return { root: page.locator("body").first(), selector: "body" };
}

async function runZapDomExtract(
  page: Page,
  containerSelector: string,
  maxOffers: number,
): Promise<ZapRawOffer[]> {
  const zapDomExtract = buildZapDomExtractFn();
  const parsed = await page.evaluate(zapDomExtract, {
    containerSelector,
    maxN: maxOffers,
  });
  return parsed.map((o) => ({
    ...o,
    hostname: normalizeHost(o.hostname),
  }));
}

function coercePrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, "").replace(/\s/g, ""));
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function absolutizeHttpUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const candidate = t.startsWith("//") ? `https:${t}` : t;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function finalizeZapLlmRows(
  rows: unknown[],
  maxOffers: number,
  allSites: Site[] | undefined,
  zapSite: Site | undefined,
  query: string,
): ZapRawOffer[] {
  const list = Array.isArray(rows) ? rows : [];
  const byHost = new Map<string, ZapRawOffer>();

  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const price = coercePrice(r.price_ils ?? r.price);
    if (price === null || price < 1 || price >= 2_000_000) continue;

    let productUrl = typeof r.product_url === "string" ? absolutizeHttpUrl(r.product_url) : null;
    if (productUrl && hostnameLooksLikeZap(productUrl)) productUrl = null;

    if (!productUrl && allSites?.length && zapSite && typeof r.retailer_name === "string") {
      const hit = findSiteByZapRetailerLabel(allSites, r.retailer_name, zapSite, query);
      if (hit) productUrl = hit.productUrl;
    }

    if (!productUrl) continue;

    let hostname = "";
    try {
      hostname = normalizeHost(new URL(productUrl).hostname);
    } catch {
      continue;
    }
    if (!hostname) continue;

    const next: ZapRawOffer = { price, productUrl, hostname };
    const prev = byHost.get(hostname);
    if (!prev || next.price < prev.price) byHost.set(hostname, next);
  }

  return Array.from(byHost.values())
    .sort((a, b) => a.price - b.price)
    .slice(0, maxOffers);
}

/**
 * Zap `models.aspx` keyword view often shows one card: price + "ב-דיאז" without http links in #divSearchResults text.
 * Pairs ₪ prices with a nearby "ב-…" line and maps the label to a configured navigator site.
 */
/**
 * `model.aspx` compare table: store names (e.g. נקסט פרו, דיאז) with ₪ prices — no "ב-" prefix.
 * Match each navigator site name in text and take the first price in the following window.
 */
function extractZapCompareRowsBySiteNames(
  innerText: string,
  searchQuery: string,
  maxOffers: number,
  allSites: Site[],
  zapSite: Site,
): ZapRawOffer[] {
  if (!innerText.trim()) return [];
  const norm = innerText.replace(/[\u200f\u200e‏]/g, "");
  const retailers = allSites
    .filter(
      (s) =>
        s.enabled &&
        s.scraperConfig?.navigatorEnabled &&
        s.id !== zapSite.id,
    )
    .sort((a, b) => b.name.length - a.name.length);

  const byHost = new Map<string, ZapRawOffer>();

  for (const site of retailers) {
    const label = site.name.trim();
    if (label.length < 2) continue;
    let pos = 0;
    while (true) {
      const idx = norm.indexOf(label, pos);
      if (idx === -1) break;
      const slice = norm.slice(idx, Math.min(norm.length, idx + 520));
      const priceMatch = slice.match(/([\d,]+)\s*(?:\n\s*)?₪/);
      if (priceMatch) {
        const price = coercePrice(priceMatch[1]);
        if (price !== null && price >= 400 && price < 2_000_000) {
          const hit = findSiteByZapRetailerLabel(allSites, label, zapSite, searchQuery);
          if (hit) {
            const hostname = normalizeHost(new URL(hit.productUrl).hostname);
            const offer: ZapRawOffer = { price, productUrl: hit.productUrl, hostname };
            const prev = byHost.get(hostname);
            if (!prev || offer.price < prev.price) byHost.set(hostname, offer);
            break;
          }
        }
      }
      pos = idx + Math.max(1, label.length);
    }
  }

  return Array.from(byHost.values())
    .sort((a, b) => a.price - b.price)
    .slice(0, maxOffers);
}

function extractZapModelsCardHeuristic(
  innerText: string,
  searchQuery: string,
  maxOffers: number,
  allSites: Site[],
  zapSite: Site,
): ZapRawOffer[] {
  const normalized = innerText.replace(/[\u200f\u200e‏]/g, "").replace(/\r/g, "");
  const priceRe = /([\d,]+)\s*(?:\n\s*)?₪/g;
  const byHost = new Map<string, ZapRawOffer>();
  let m: RegExpExecArray | null;
  while ((m = priceRe.exec(normalized)) !== null) {
    const price = coercePrice(m[1]);
    if (price === null || price < 1 || price >= 2_000_000) continue;
    if (price < 400) continue;
    const winStart = Math.max(0, m.index - 160);
    const winEnd = Math.min(normalized.length, m.index + 320);
    const window = normalized.slice(winStart, winEnd);
    const retailerMatch = /ב[-־]\s*([^\n₪]+)/u.exec(window);
    if (!retailerMatch) continue;
    const retailerLine = `ב-${retailerMatch[1].trim()}`;
    const hit = findSiteByZapRetailerLabel(allSites, retailerLine, zapSite, searchQuery);
    if (!hit) continue;
    const hostname = normalizeHost(new URL(hit.productUrl).hostname);
    const offer: ZapRawOffer = { price, productUrl: hit.productUrl, hostname };
    const prev = byHost.get(hostname);
    if (!prev || offer.price < prev.price) byHost.set(hostname, offer);
  }
  return Array.from(byHost.values())
    .sort((a, b) => a.price - b.price)
    .slice(0, maxOffers);
}

type ZapLlmJson = { offers?: unknown[] };

/**
 * Parse Zap search results plain text with a structured LLM call. Returns [] on failure.
 */
async function extractZapOffersWithLlm(
  resultsInnerText: string,
  query: string,
  maxOffers: number,
  allSites: Site[] | undefined,
  zapSite: Site,
): Promise<ZapRawOffer[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const capped = resultsInnerText.trim();
  if (!capped) return [];

  const userContent = `Search query: "${query}"

Below is visible plain text copied from the Zap.co.il price-comparison search results panel (may include Hebrew / RTL; may be truncated). Extract up to ${maxOffers} distinct **retailer** offers: outbound links to real stores (not zap.co.il).

Return JSON only:
{
  "offers": [
    {
      "retailer_name": "short store label as shown (e.g. דיאז or line starting with ב-)",
      "price_ils": 1234,
      "product_url": "https://retailer.example/..."
    }
  ]
}

Rules:
- price_ils must be a positive integer (ILS).
- If the text includes a real http(s) store link that is NOT zap.co.il, set product_url to that URL.
- If there is NO store URL in the text but you see a retailer line (often "ב-שם החנות"), still include the row with retailer_name from that line and omit product_url or set it to null.
- Skip Zap-only links, ads without a clear price, or duplicate retailers.
- At most ${maxOffers} offers.
- No markdown, no commentary.

--- RESULT TEXT ---
${capped}`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You extract structured price offers from Israeli e-commerce aggregator text. Return only valid JSON.",
          },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: ZAP_LLM_TIMEOUT_MS,
      },
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) {
      await logScrape(appendLlmTokenUsage("Zap LLM: empty content", response.data?.usage));
      return [];
    }

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const parsed = JSON.parse(jsonStr) as ZapLlmJson;
    const finalized = finalizeZapLlmRows(
      parsed.offers ?? [],
      maxOffers,
      allSites,
      zapSite,
      query,
    );

    await logScrape(
      appendLlmTokenUsage(
        `Zap: LLM structured ${finalized.length} offer(s) for "${query}"`,
        response.data?.usage,
      ),
    );
    return finalized;
  } catch (err) {
    await logScrapeError(`Zap: LLM extract failed for "${query}"`, err);
    return [];
  }
}

/**
 * Search Zap and extract top retailer offers (document order ≈ price asc on compare UI).
 * `zapExtractMode: "llm"` uses innerText + GPT JSON, plaintext heuristic (models.aspx cards), then DOM.
 * @param allSites - all sites from store; used to map "ב-דיאז" style labels and Zap-only navigator runs.
 */
export async function runZapNavigatorExtract(
  page: Page,
  zapSite: Site,
  query: string,
  allSites?: Site[],
): Promise<ZapRawOffer[]> {
  const cfg = zapSite.scraperConfig;
  const maxOffers = Math.max(1, Math.min(50, cfg?.zapMaxOffers ?? 8));
  const inputSel = cfg?.zapSearchInputSelector?.trim() || "#acSearch-input";
  const primaryContainerSel = cfg?.zapResultsContainerSelector?.trim() || "#divSearchResults";
  const extractMode = cfg?.zapExtractMode ?? "dom";
  const llmMaxChars = Math.max(
    2000,
    Math.min(cfg?.zapExtractLlmMaxChars ?? ZAP_LLM_DEFAULT_MAX_CHARS, 50_000),
  );

  const base = zapSite.baseUrl.split("?")[0];
  const startUrl = base.endsWith("/") ? base : `${base}/`;

  try {
    await page.goto(startUrl, {
      waitUntil: "domcontentloaded",
      timeout: ZAP_GOTO_TIMEOUT_MS,
    });
    await runZapPreSteps(page, zapSite);
    await dismissZapOverlayModals(page, zapSite);

    const searchInput = page.locator(inputSel).first();
    await searchInput.waitFor({ state: "visible", timeout: 12_000 });
    await searchInput.fill("");
    await searchInput.fill(query);
    await searchInput.press("Enter");

    await new Promise((r) => setTimeout(r, 600));
    await dismissZapOverlayModals(page, zapSite);

    await page
      .locator(`${primaryContainerSel}, main`)
      .first()
      .waitFor({ state: "visible", timeout: ZAP_RESULTS_TIMEOUT_MS })
      .catch(() => null);

    if (!(await page.locator("main").isVisible().catch(() => false))) {
      await dismissZapOverlayModals(page, zapSite);
      await new Promise((r) => setTimeout(r, 400));
      await page
        .locator(`${primaryContainerSel}, main`)
        .first()
        .waitFor({ state: "visible", timeout: Math.min(12_000, ZAP_RESULTS_TIMEOUT_MS) })
        .catch(() => null);
    }

    const extraWait = cfg?.waitExtraMs ?? 2000;
    if (extraWait > 0) {
      await new Promise((r) => setTimeout(r, Math.min(extraWait, 5000)));
    }

    if (!(await page.locator("main").isVisible().catch(() => false))) {
      await dismissZapOverlayModals(page, zapSite);
      await new Promise((r) => setTimeout(r, 350));
    }

    const { root: resultsRoot, selector: scopeUsed } = await resolveZapExtractionScope(page, cfg);
    if (scopeUsed !== primaryContainerSel) {
      await logScrape(`Zap: extraction scope "${scopeUsed}" (${primaryContainerSel} had little or no text)`);
    }

    const rawText = await resultsRoot.innerText().catch(() => "");
    const trimmed = rawText.trim();

    let offers: ZapRawOffer[] = [];

    if (extractMode === "llm" && process.env.OPENAI_API_KEY) {
      const snapshot =
        trimmed.length > llmMaxChars
          ? `${trimmed.slice(0, llmMaxChars)}\n...[truncated]`
          : trimmed;

      if (trimmed.length > llmMaxChars) {
        await logScrape(
          `Zap: LLM snapshot truncated ${trimmed.length} → ${llmMaxChars} chars for "${query}"`,
        );
      }

      offers = await extractZapOffersWithLlm(snapshot, query, maxOffers, allSites, zapSite);
      if (offers.length === 0) {
        await logScrape(`Zap: LLM returned no valid offers, trying plaintext heuristic / DOM for "${query}"`);
      }
    } else if (extractMode === "llm" && !process.env.OPENAI_API_KEY) {
      await logScrape(
        `Zap: zapExtractMode=llm but OPENAI_API_KEY is missing — using heuristic / DOM extract for "${query}"`,
      );
    }

    if (offers.length === 0 && allSites?.length) {
      const byName = extractZapCompareRowsBySiteNames(trimmed, query, maxOffers, allSites, zapSite);
      if (byName.length) {
        offers = byName;
        await logScrape(`Zap: compare-table name heuristic ${byName.length} offer(s) for "${query}"`);
      }
    }

    if (offers.length === 0 && allSites?.length) {
      const cardHeur = extractZapModelsCardHeuristic(trimmed, query, maxOffers, allSites, zapSite);
      if (cardHeur.length) {
        offers = cardHeur;
        await logScrape(`Zap: plaintext card heuristic ${cardHeur.length} offer(s) for "${query}"`);
      }
    }

    if (offers.length === 0) {
      offers = await runZapDomExtract(page, scopeUsed, maxOffers);
    }

    if (offers.length === 0) {
      await saveZapDebugArtifacts(page, resultsRoot, query, "no offers after LLM + DOM");
      await logScrape(`Zap: no retailer rows parsed for query "${query}"`);
      return [];
    }

    await logScrape(`Zap: parsed ${offers.length} offer(s) for "${query}"`);
    return offers;
  } catch (err) {
    await logScrapeError(`Zap: extract failed for "${query}"`, err);
    await saveZapDebugArtifacts(
      page,
      page.locator(primaryContainerSel).first(),
      query,
      `exception: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
