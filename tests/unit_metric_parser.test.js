/**
 * Unit Tests: Metric Parser
 * Tests all Vietnamese and international number formats per spec §10.
 * 
 * NOTE: These are UNIT TESTS using code-level logic only.
 * No mocks, no network calls, no AI calls.
 */
import assert from 'assert';
import { parseMetric, parseDuration, resolveMetric } from '../src/platforms/metricParser.js';

export async function run() {
  console.log('--- Unit: Metric Parser ---');

  // ── parseMetric ──────────────────────────────────────────────────

  // Standard integers
  assert.strictEqual(parseMetric('999').value, 999);
  assert.strictEqual(parseMetric('0').value, 0);
  assert.strictEqual(parseMetric(0).value, 0);

  // Explicit distinction: 0 is NOT null
  assert.strictEqual(parseMetric(0).value, 0);
  assert.notStrictEqual(parseMetric(0).value, null);

  // Null / undefined → value must be null
  assert.strictEqual(parseMetric(null).value, null);
  assert.strictEqual(parseMetric(undefined).value, null);
  assert.strictEqual(parseMetric('').value, null);

  console.log('✓ parseMetric: 0 vs null vs undefined distinction verified');

  // K notation
  assert.strictEqual(parseMetric('1K').value, 1000);
  assert.strictEqual(parseMetric('1.5K').value, 1500);
  assert.strictEqual(parseMetric('1,5K').value, 1500);
  assert.strictEqual(parseMetric('221K').value, 221000);
  console.log('✓ parseMetric: K notation (1K, 1.5K, 1,5K, 221K)');

  // Vietnamese: Triệu / Tr
  assert.strictEqual(parseMetric('1M').value, 1_000_000);
  assert.strictEqual(parseMetric('1,2 triệu').value, 1_200_000);
  assert.strictEqual(parseMetric('2 Tr').value, 2_000_000);
  console.log('✓ parseMetric: Triệu / Tr / M notation');

  // Vietnamese: N (nghìn)
  assert.strictEqual(parseMetric('221 N').value, 221_000);
  console.log('✓ parseMetric: N (nghìn) notation');

  // "999+" → at least 999
  const result999Plus = parseMetric('999+');
  assert.strictEqual(result999Plus.value, 999);
  assert.ok(result999Plus.note === 'AT_LEAST' || result999Plus.confidence < 1, 'Should flag uncertainty');
  console.log('✓ parseMetric: 999+ notation');

  // Hidden metrics
  assert.strictEqual(parseMetric('Số liệu bị ẩn').value, null);
  assert.strictEqual(parseMetric('Số liệu bị ẩn').error, 'HIDDEN');
  assert.strictEqual(parseMetric('Không có lượt xem').value, null);
  console.log('✓ parseMetric: Hidden metric detection');

  // Source tracking
  const tracked = parseMetric('1.5K', 'DOM', 'span.reactions-count');
  assert.strictEqual(tracked.source, 'DOM');
  assert.strictEqual(tracked.selector, 'span.reactions-count');
  assert.strictEqual(tracked.value, 1500);
  console.log('✓ parseMetric: Source tracking (source, selector)');

  // ── parseDuration ──────────────────────────────────────────────────

  // MM:SS format
  assert.strictEqual(parseDuration('30:00').value, 1800);
  assert.strictEqual(parseDuration('0:30').value, 30);
  assert.strictEqual(parseDuration('1:00:00').value, 3600);
  assert.strictEqual(parseDuration('14:59').value, 899);
  assert.strictEqual(parseDuration('15:00').value, 900);
  console.log('✓ parseDuration: MM:SS and HH:MM:SS formats');

  // Boundary values — critical for ĐK1 logic
  assert.strictEqual(parseDuration('0:29').value, 29);   // video just below minimum
  assert.strictEqual(parseDuration('0:30').value, 30);   // exactly at minimum
  assert.strictEqual(parseDuration('0:31').value, 31);   // above minimum
  assert.strictEqual(parseDuration('14:59').value, 899); // livestream just below minimum
  assert.strictEqual(parseDuration('15:00').value, 900); // exactly at livestream minimum
  assert.strictEqual(parseDuration('15:01').value, 901); // above livestream minimum
  console.log('✓ parseDuration: Boundary values for ĐK1 verification');

  // Text formats
  assert.strictEqual(parseDuration('45s').value, 45);
  assert.strictEqual(parseDuration('45 giây').value, 45);
  assert.strictEqual(parseDuration('15 phút').value, 900);
  assert.strictEqual(parseDuration('2 giờ 30 phút').value, 9000);
  console.log('✓ parseDuration: Text duration formats (Vietnamese)');

  // Null / empty
  assert.strictEqual(parseDuration(null).value, null);
  assert.strictEqual(parseDuration('').value, null);
  console.log('✓ parseDuration: null/empty handling');

  // ── resolveMetric ──────────────────────────────────────────────────

  // Priority: DOM > OCR > AI
  const resolved = resolveMetric([
    { value: 1000, source: 'AI', confidence: 0.9 },
    { value: 1200, source: 'DOM', confidence: 1.0 },
    { value: 1100, source: 'OCR', confidence: 0.8 }
  ]);
  assert.strictEqual(resolved.value, 1200);
  assert.strictEqual(resolved.source, 'DOM');
  console.log('✓ resolveMetric: Priority selection (DOM > OCR > AI)');

  // Conflict detection
  const conflictedResult = resolveMetric([
    { value: 100, source: 'DOM', confidence: 1.0 },
    { value: 5000, source: 'OCR', confidence: 0.8 }
  ]);
  assert.strictEqual(conflictedResult.conflicted, true);
  console.log('✓ resolveMetric: Conflict detection when values differ >10%');

  // All null → value null
  const allNull = resolveMetric([
    { value: null, source: 'DOM', confidence: 0 },
    { value: null, source: 'OCR', confidence: 0 }
  ]);
  assert.strictEqual(allNull.value, null);
  console.log('✓ resolveMetric: All null candidates returns null');

  console.log('✓ All Metric Parser tests passed!\n');
}
