/**
 * Metric Parser — parses Vietnamese and international number formats.
 * 
 * CRITICAL RULES (per spec §10):
 *  - 0 (zero)     = explicit value, metric IS zero
 *  - null         = metric not shown, not applicable, or hidden
 *  - undefined    = not yet processed
 *  - ERROR state  = parsing failed (throws or returns { value: null, error: 'msg' })
 *
 * NEVER use: value || 0  (hides distinction between 0 and null)
 * NEVER assume null = 0
 */

/**
 * Parse a metric string to a numeric value.
 * Returns a source-tracked metric object.
 * 
 * @param {string|number|null|undefined} raw - Raw metric text or value
 * @param {string} [source] - Data source (DOM, OCR, AI, METADATA)
 * @param {string} [selector] - CSS selector used to extract (if DOM)
 * @returns {{ value: number|null, rawValue: string, source: string, confidence: number, selector: string|null, error: string|null }}
 */
export function parseMetric(raw, source = 'DOM', selector = null) {
  const rawValue = raw !== null && raw !== undefined ? String(raw).trim() : null;

  // Not available / not applicable
  if (raw === null || raw === undefined) {
    return { value: null, rawValue: null, source, confidence: 0, selector, error: null };
  }

  if (rawValue === '') {
    return { value: null, rawValue: '', source, confidence: 0, selector, error: null };
  }

  // Already a number
  if (typeof raw === 'number') {
    return { value: raw, rawValue: String(raw), source, confidence: 1, selector, error: null };
  }

  const text = rawValue.toLowerCase().trim();

  // Explicitly hidden metrics
  const hiddenPatterns = [
    'số liệu bị ẩn',
    'hidden',
    'ẩn',
    'không hiển thị',
    'không có lượt',
    'not available',
  ];
  if (hiddenPatterns.some(p => text.includes(p))) {
    return { value: null, rawValue, source, confidence: 1, selector, error: 'HIDDEN' };
  }

  // "999+" means at least 999 but unknown exact — store as-is with note
  if (text.endsWith('+')) {
    const numPart = text.slice(0, -1).replace(/[,\s]/g, '');
    const parsed = parseFloat(numPart);
    if (!isNaN(parsed)) {
      return { value: parsed, rawValue, source, confidence: 0.7, selector, error: null, note: 'AT_LEAST' };
    }
  }

  // Remove commas used as thousand separators, but keep decimal dots/commas
  // Handle "1,5K" (Vietnamese comma decimal) and "1.5K" (dot decimal)
  let normalized = text
    .replace(/\s+/g, '')
    .replace(/\./g, '')       // strip thousand-sep dots: "1.200" → "1200"
    ;

  // Vietnamese / shorthand multipliers
  const multipliers = [
    { pattern: /(\d+[,.]?\d*)\s*(nghìn|nghin|k)/i, factor: 1_000 },
    { pattern: /(\d+[,.]?\d*)\s*(triệu|trieu|tr|m)/i, factor: 1_000_000 },
    { pattern: /(\d+[,.]?\d*)\s*(tỷ|ty|b)/i, factor: 1_000_000_000 },
    // "n" stands for "nghìn" (1000) in Vietnamese short form
    { pattern: /^(\d+[,.]?\d*)\s*n$/i, factor: 1_000 },
  ];

  for (const { pattern, factor } of multipliers) {
    const match = rawValue.replace(/\s/g, '').match(pattern);
    if (match) {
      const numStr = match[1].replace(',', '.');
      const num = parseFloat(numStr);
      if (!isNaN(num)) {
        return { value: Math.round(num * factor), rawValue, source, confidence: 0.95, selector, error: null };
      }
    }
  }

  // Plain number after stripping commas
  const plainNum = normalized.replace(/,/g, '');
  const parsed = parseFloat(plainNum);
  if (!isNaN(parsed)) {
    return { value: parsed, rawValue, source, confidence: 1, selector, error: null };
  }

  // Extraction failure
  return { value: null, rawValue, source, confidence: 0, selector, error: `PARSE_FAILED: "${rawValue}"` };
}

/**
 * Parse duration string to seconds.
 * Handles: "30:00", "1:30:45", "45s", "15 phút", "2 giờ 30 phút"
 * 
 * @param {string|null} raw
 * @param {string} [source]
 * @returns {{ value: number|null, rawValue: string, source: string, confidence: number, error: string|null }}
 */
export function parseDuration(raw, source = 'DOM') {
  if (raw === null || raw === undefined) {
    return { value: null, rawValue: null, source, confidence: 0, error: null };
  }

  const rawValue = String(raw).trim();
  if (!rawValue) {
    return { value: null, rawValue, source, confidence: 0, error: null };
  }

  // "HH:MM:SS" or "MM:SS"
  const colonMatch = rawValue.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const h = colonMatch[3] ? parseInt(colonMatch[1]) : 0;
    const m = colonMatch[3] ? parseInt(colonMatch[2]) : parseInt(colonMatch[1]);
    const s = colonMatch[3] ? parseInt(colonMatch[3]) : parseInt(colonMatch[2]);
    return { value: h * 3600 + m * 60 + s, rawValue, source, confidence: 1, error: null };
  }

  // "45s" or "45 giây"
  const secMatch = rawValue.match(/^(\d+)\s*(s|giây|sec|second)/i);
  if (secMatch) {
    return { value: parseInt(secMatch[1]), rawValue, source, confidence: 1, error: null };
  }

  // "15 phút" / "15 min"
  const minMatch = rawValue.match(/^(\d+)\s*(phút|ph|min|minute)/i);
  if (minMatch) {
    return { value: parseInt(minMatch[1]) * 60, rawValue, source, confidence: 1, error: null };
  }

  // "2 giờ 30 phút"
  const hrMinMatch = rawValue.match(/(\d+)\s*(giờ|gio|h|hr|hour)\s*(?:(\d+)\s*(phút|ph|min))?/i);
  if (hrMinMatch) {
    const h = parseInt(hrMinMatch[1]);
    const m = hrMinMatch[3] ? parseInt(hrMinMatch[3]) : 0;
    return { value: h * 3600 + m * 60, rawValue, source, confidence: 1, error: null };
  }

  return { value: null, rawValue, source, confidence: 0, error: `PARSE_FAILED: "${rawValue}"` };
}

/**
 * Choose the most reliable metric from multiple sources.
 * Priority: METADATA > DOM > ACCESSIBILITY > OCR > AI
 * 
 * @param {Array<{value: number|null, source: string, confidence: number}>} candidates
 * @returns {{ value: number|null, source: string, confidence: number, conflicted: boolean }}
 */
export function resolveMetric(candidates) {
  const priority = ['METADATA', 'DOM', 'ACCESSIBILITY', 'NETWORK', 'OCR', 'AI'];
  
  const valid = candidates.filter(c => c && c.value !== null && c.value !== undefined && !c.error);
  if (valid.length === 0) {
    return { value: null, source: null, confidence: 0, conflicted: false };
  }

  // Check for conflict: values differ by more than 10%
  const values = valid.map(c => c.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const conflicted = max > 0 && (max - min) / max > 0.10;

  // Pick highest-priority valid source
  for (const source of priority) {
    const candidate = valid.find(c => c.source === source);
    if (candidate) {
      return { ...candidate, conflicted };
    }
  }

  // Fallback: highest confidence
  const best = valid.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return { ...best, conflicted };
}
