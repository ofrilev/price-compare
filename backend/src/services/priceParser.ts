/**
 * Parse price string (e.g. "₪99.90", "$1,234.56", "1.234,56") to number
 */
export function parsePrice(text: string): number | null {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return null;

  // Handle European format: 1.234,56 (dot = thousands, comma = decimal)
  const hasCommaDecimal = /,\d{1,2}$/.test(cleaned);
  const hasDotThousands = /^\d{1,3}(\.\d{3})+,\d{2}$/.test(cleaned);

  if (hasCommaDecimal || hasDotThousands) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    return parseFloat(normalized) || null;
  }

  // Handle US format: 1,234.56 (comma = thousands, dot = decimal)
  const normalized = cleaned.replace(/,/g, "");
  return parseFloat(normalized) || null;
}
