/**
 * Treat letter–hyphen–digit like letter+digit (e.g. DGX-670 ≡ DGX670) for matching.
 */
export function collapseHyphensInLetterDigitModels(s: string): string {
  let out = s;
  // Repeated passes for patterns like A-B-123
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/([a-zA-Z])-+(\d)/gi, "$1$2");
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Normalize search term for flexible product matching.
 * e.g. "piano cx40" matches "CX-40", "CX 40", "cx40", "Yamaha P-225" matches "P 225", "P-225"
 */
export function buildProductMatchRegex(searchTerm: string): RegExp {
  const words = searchTerm
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      // Model-like: letters followed by digits (e.g. cx40, p225, px-s1100)
      const alnumMatch = word.match(/^([a-zA-Z]+)[\s\-]*([0-9][a-zA-Z0-9]*)$/);
      if (alnumMatch) {
        const letters = alnumMatch[1];
        const rest = alnumMatch[2];
        return letters + "[\\s\\-]*" + rest;
      }
      // Digits followed by letters (e.g. 40cx)
      const numFirst = word.match(/^([0-9]+)[\s\-]*([a-zA-Z]+)$/);
      if (numFirst) {
        return numFirst[1] + "[\\s\\-]*" + numFirst[2];
      }
      return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });

  // All parts must appear (order flexible)
  const lookaheads = words.map((p) => `(?=.*${p})`).join("");
  return new RegExp(lookaheads, "i");
}

export function matchesProduct(productName: string, searchTerm: string): boolean {
  const pn = collapseHyphensInLetterDigitModels(productName);
  const st = collapseHyphensInLetterDigitModels(searchTerm);
  return buildProductMatchRegex(st).test(pn);
}

/**
 * Generate fallback search terms when the original yields no results.
 * Uses product-specific variations when defined, plus general pattern-based fallbacks.
 * e.g. "Roland FP-10" → ["Roland FP-10", "roland fp10", "roland fp 10", "Roland FP 10", "Roland FP10"]
 */
export function getSearchTermFallbacks(searchTerm: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const add = (s: string) => {
    const t = s.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  };

  add(searchTerm);
  add(collapseHyphensInLetterDigitModels(searchTerm));

  // Match model patterns: letters + hyphen/space + digits (e.g. FP-10, P 225)
  const modelPattern = /([a-zA-Z]+)([\s\-]+)([0-9][a-zA-Z0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = modelPattern.exec(searchTerm)) !== null) {
    const [full, letters, , rest] = m;
    add(searchTerm.replace(full, `${letters} ${rest}`)); // hyphen → space
    add(searchTerm.replace(full, letters + rest)); // no separator
    add(searchTerm.replace(full, `${letters}-${rest}`)); // space → hyphen
    add(searchTerm.replace(full, `${letters.toLowerCase()} ${rest}`)); // lowercase + space
    add(searchTerm.replace(full, `${letters.toLowerCase()}${rest}`)); // lowercase, no separator
  }

  return result;
}
