import axios from "axios";
import type { Page } from "playwright";
import { logScrape, logScrapeError } from "./scrapeLogger.js";
import type { Product } from "../types.js";
import type { Site } from "../types.js";

interface ActionPayload {
  action: "select_index" | "click_selector" | "none";
  selectIndex?: number;
  selector?: string;
}

/**
 * Optional LLM pass: numbered list of interactables → one safe action.
 */
export async function tryNavigatorVariantAssist(
  page: Page,
  site: Site,
  product: Product
): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;

  const snapshot = await page.evaluate(() => {
    const items: { i: number; kind: string; label: string }[] = [];
    let idx = 0;
    document.querySelectorAll("select").forEach((el) => {
      if (el.offsetParent === null) return;
      const id = (el as HTMLSelectElement).id || el.getAttribute("name") || "select";
      items.push({ i: idx++, kind: "select", label: id });
    });
    document.querySelectorAll('input[type="radio"]').forEach((el) => {
      const inp = el as HTMLInputElement;
      if (inp.offsetParent === null) return;
      const lab = inp.getAttribute("aria-label") || inp.name || "radio";
      items.push({ i: idx++, kind: "radio", label: lab });
    });
    document.querySelectorAll("button[class*='swatch'], .variation-selector button").forEach((el) => {
      if ((el as HTMLElement).offsetParent === null) return;
      const t = (el.textContent || "").trim().slice(0, 80);
      items.push({ i: idx++, kind: "button", label: t || "swatch" });
    });
    return items.slice(0, 25);
  });

  if (snapshot.length === 0) return false;

  const list = snapshot.map((s) => `${s.i}: [${s.kind}] ${s.label}`).join("\n");

  const prompt = `Product: ${product.name}. Site: ${site.name}.
Pick ONE action to reveal the product price (variant/color/size).

Elements:
${list}

Return JSON only:
{ "action": "select_index", "selectIndex": 0 }  // use first select, pick first option
OR { "action": "click_selector", "selector": "css" }  // valid single selector
OR { "action": "none" }

Prefer select_index 0 if any select exists.`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Return only valid JSON for UI automation. No markdown.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 12000,
      }
    );

    const content = response.data.choices[0]?.message?.content?.trim();
    if (!content) return false;
    const parsed = JSON.parse(content) as ActionPayload;
    if (parsed.action === "none") return false;

    if (parsed.action === "select_index" && typeof parsed.selectIndex === "number") {
      const sel = page.locator("select:visible").nth(parsed.selectIndex);
      if ((await sel.count()) === 0) return false;
      await sel.selectOption({ index: 0 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 1500));
      await logScrape(`Navigator ${site.name}: LLM variant assist select index ${parsed.selectIndex}`);
      return true;
    }

    if (parsed.action === "click_selector" && parsed.selector?.trim()) {
      await page.locator(parsed.selector.trim()).first().click({ timeout: 4000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 1500));
      await logScrape(`Navigator ${site.name}: LLM variant assist click ${parsed.selector}`);
      return true;
    }
  } catch (err) {
    await logScrapeError("NavigatorVariantAssist error", err);
  }

  return false;
}
