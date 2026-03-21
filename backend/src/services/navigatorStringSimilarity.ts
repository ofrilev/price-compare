import { collapseHyphensInLetterDigitModels } from "./searchTermNormalizer.js";

/**
 * Token-overlap + substring similarity for ranking search result titles against product name.
 * No external dependency.
 */
const norm = (s: string) =>
  collapseHyphensInLetterDigitModels(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

export function similarityScore(candidateText: string, productName: string, searchTerm: string): number {
  const hay = collapseHyphensInLetterDigitModels(
    `${candidateText} ${productName} ${searchTerm}`
  ).toLowerCase();
  const needles = new Set([...norm(productName), ...norm(searchTerm || productName)]);
  if (needles.size === 0) return 0;

  let hits = 0;
  for (const w of needles) {
    if (w.length < 2) continue;
    if (hay.includes(w)) hits += w.length;
  }

  const maxLen = Math.max(productName.length, searchTerm.length, 1);
  const ratio = hits / maxLen;

  const pn = collapseHyphensInLetterDigitModels(productName).toLowerCase();
  const ct = collapseHyphensInLetterDigitModels(candidateText).toLowerCase();
  const stn = collapseHyphensInLetterDigitModels(searchTerm || productName).toLowerCase();
  let bonus = 0;
  if (pn.length > 3 && ct.includes(pn)) bonus += 2;
  if (stn.length > 3 && ct.includes(stn)) bonus += 1.5;

  return ratio + bonus;
}
