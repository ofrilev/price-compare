import type { Site } from "../types.js";

export interface RawProduct {
  name: string;
  priceText: string;
  url: string;
}

export interface BaseParser {
  parseSite(html: string, site: Site): RawProduct[];
}
