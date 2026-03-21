# E-Commerce Navigator mode

Navigator is a fourth scrape mode (`mode: "navigator"`) that uses **Playwright** plus **LLM-planned search queries**, **link ranking** on result pages, **variant heuristics** (selects / radios / swatches), and an optional **LLM variant assist** pass. It then runs the same **GPT comparison** step as the default scraper pipeline.

## Requirements

- `OPENAI_API_KEY` — query planner, variant assist (optional), and GPT comparison.
- `OPENAI_MODEL` (optional, default `gpt-4o-mini`).
- Playwright (already a backend dependency).

## Enabling per site

In `data/sites.json`, under `scraperConfig`:

- **`navigatorEnabled`: `true`** — site participates in Navigator runs.
- **`navigatorResultContainer`** (optional) — CSS selectors (comma-separated) limiting where result links are collected (e.g. `.productlist`, `main`).
- **`categoryUrlByProductCategory`** (optional) — map `Product.category` values to category page paths or full URLs used when search returns no links.

Enable **`navigatorEnabled`: `true`** on each competitor site that should use Navigator (classic scraper remains the default for sites without it).

## API / UI

- POST `/scrape` body: `{ "mode": "navigator", "productIds": [...], "siteIds": [...] }`
- Backoffice: **השוואת מחירים** → mode **Navigator (סוכן)**.

## vs other modes

| Mode            | Browser | Typical use                                     |
| --------------- | ------- | ----------------------------------------------- |
| `scraper`       | Yes     | Fast CSS/Cheerio extraction from search HTML    |
| `llm_websearch` | No      | OpenAI search-preview; no DOM / variants        |
| `navigator`     | Yes     | Slower; handles naming fallbacks & PDP variants |

## Cost & reliability

Navigator opens **one browser tab per site per product**, may call the LLM for query planning and occasionally for variant assist, then GPT comparison. It is **more fragile** than fixed selectors; use for sites or SKUs where the classic scraper underperforms.

## Logs

Navigator steps are written via `scrapeLogger` (same log files as other scrapes), prefixed with `Navigator`.
