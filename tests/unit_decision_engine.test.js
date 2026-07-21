/**
 * Unit Tests: Decision Engine
 * Tests all ĐK1/ĐK2 boundary values per spec §16 Gate 4.
 *
 * NOTE: Pure unit tests — no mocks, no network, no AI calls.
 * All decisions must be deterministic and code-based.
 */
import assert from 'assert';
import { evaluateDk1, evaluateDk2, computeEvaluation } from '../src/engine/evaluationEngine.js';

const DEFAULT_RULE = {
  productNames: ['Smarta Grow', 'Metacare'],
  requiredHashtags: ['#10tyloikhuan', '#caovuottroi'],
  requiredTags: ['@HùngCườngCompany'],
  minVideoDurationSec: 30,
  minLivestreamDurationSec: 900,
  requireCTA: true
};

function makeScrape(overrides = {}) {
  return {
    success: true,
    accessState: 'ACCESSIBLE',
    platform: 'FACEBOOK',
    postType: 'Video clip',
    durationSeconds: 45,
    captionText: 'Bài dự thi #10tyloikhuan #caovuottroi @HùngCườngCompany Smarta Grow mua ngay',
    likes: 100,
    comments: 10,
    shares: 5,
    views: 1000,
    ...overrides
  };
}

export async function run() {
  console.log('--- Unit: Decision Engine ---');

  // ── ĐK1 Boundary Tests ──────────────────────────────────────────────

  // Video: 29s → FAILED
  let dk1 = evaluateDk1(makeScrape({ postType: 'Video clip', durationSeconds: 29 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'FAILED', 'Video 29s should FAIL ĐK1');
  assert.strictEqual(dk1.passed, false);

  // Video: 30s → PASSED (exactly at boundary)
  dk1 = evaluateDk1(makeScrape({ postType: 'Video clip', durationSeconds: 30 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'PASSED', 'Video 30s should PASS ĐK1');
  assert.strictEqual(dk1.passed, true);

  // Video: 31s → PASSED
  dk1 = evaluateDk1(makeScrape({ postType: 'Video clip', durationSeconds: 31 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'PASSED', 'Video 31s should PASS ĐK1');

  console.log('✓ ĐK1: Video clip boundary values (29s→FAIL, 30s→PASS, 31s→PASS)');

  // Livestream: 899s → FAILED
  dk1 = evaluateDk1(makeScrape({ postType: 'Livestream', durationSeconds: 899 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'FAILED', 'Livestream 899s should FAIL ĐK1');

  // Livestream: 900s → PASSED
  dk1 = evaluateDk1(makeScrape({ postType: 'Livestream', durationSeconds: 900 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'PASSED', 'Livestream 900s should PASS ĐK1');

  // Livestream: 901s → PASSED
  dk1 = evaluateDk1(makeScrape({ postType: 'Livestream', durationSeconds: 901 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'PASSED', 'Livestream 901s should PASS ĐK1');

  console.log('✓ ĐK1: Livestream boundary values (899s→FAIL, 900s→PASS, 901s→PASS)');

  // Missing duration → NEEDS_REVIEW (NOT FAILED)
  dk1 = evaluateDk1(makeScrape({ durationSeconds: null }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'NEEDS_REVIEW', 'Missing duration should be NEEDS_REVIEW, NOT FAILED');
  assert.strictEqual(dk1.passed, null, 'passed must be null when data is missing');

  console.log('✓ ĐK1: Missing duration → NEEDS_REVIEW (not FAILED)');

  // Unknown post type → NEEDS_REVIEW
  dk1 = evaluateDk1(makeScrape({ postType: 'Unknown', durationSeconds: 50 }), DEFAULT_RULE);
  assert.strictEqual(dk1.status, 'NEEDS_REVIEW');
  assert.strictEqual(dk1.passed, null);

  console.log('✓ ĐK1: Unknown post type → NEEDS_REVIEW');

  // ── ĐK2 Tests ──────────────────────────────────────────────────────

  // Full valid caption → PASSED
  const validScrape = makeScrape({
    captionText: '#10tyloikhuan #caovuottroi @HùngCườngCompany Smarta Grow mua ngay tại đây!'
  });
  let dk2 = evaluateDk2(validScrape, DEFAULT_RULE);
  assert.strictEqual(dk2.status, 'PASSED');
  assert.strictEqual(dk2.passed, true);
  assert.strictEqual(dk2.detail.missingHashtags.length, 0);
  assert.strictEqual(dk2.detail.missingTags.length, 0);
  assert.strictEqual(dk2.detail.productMatched, true);

  console.log('✓ ĐK2: Full valid caption → PASSED');

  // Missing one hashtag → FAILED
  dk2 = evaluateDk2(makeScrape({ captionText: '#10tyloikhuan @HùngCườngCompany Smarta Grow mua ngay' }), DEFAULT_RULE);
  assert.strictEqual(dk2.status, 'FAILED');
  assert.strictEqual(dk2.passed, false);
  assert.ok(dk2.detail.missingHashtags.includes('#caovuottroi'), 'Should report missing hashtag');
  assert.ok(dk2.reason.includes('#caovuottroi'));

  console.log('✓ ĐK2: Missing one hashtag → FAILED with specific reason');

  // Missing fanpage tag → FAILED
  dk2 = evaluateDk2(makeScrape({ captionText: '#10tyloikhuan #caovuottroi Smarta Grow mua ngay' }), DEFAULT_RULE);
  assert.strictEqual(dk2.status, 'FAILED');
  assert.ok(dk2.detail.missingTags.includes('@HùngCườngCompany'));

  console.log('✓ ĐK2: Missing fanpage tag → FAILED with specific reason');

  // Missing product name → FAILED
  dk2 = evaluateDk2(makeScrape({ captionText: '#10tyloikhuan #caovuottroi @HùngCườngCompany mua ngay' }), DEFAULT_RULE);
  assert.strictEqual(dk2.status, 'FAILED');
  assert.strictEqual(dk2.detail.productMatched, false);

  console.log('✓ ĐK2: Missing product name → FAILED');

  // Missing caption → NEEDS_REVIEW (not FAILED)
  dk2 = evaluateDk2(makeScrape({ captionText: null }), DEFAULT_RULE);
  assert.strictEqual(dk2.status, 'NEEDS_REVIEW');
  assert.strictEqual(dk2.passed, null, 'passed must be null when caption is missing');

  console.log('✓ ĐK2: Missing caption → NEEDS_REVIEW (not FAILED)');

  // ── computeEvaluation Full Flow ─────────────────────────────────────

  // PASSED case
  let evalRes = computeEvaluation(
    makeScrape({ postType: 'Video clip', durationSeconds: 45, captionText: '#10tyloikhuan #caovuottroi @HùngCườngCompany Smarta Grow mua ngay' }),
    DEFAULT_RULE
  );
  assert.strictEqual(evalRes.businessResult, 'PASSED');
  assert.strictEqual(evalRes.dk1.status, 'PASSED');
  assert.strictEqual(evalRes.dk2.status, 'PASSED');
  console.log('✓ computeEvaluation: PASSED case');

  // FAILED case (short video)
  evalRes = computeEvaluation(
    makeScrape({ durationSeconds: 10, captionText: '#10tyloikhuan #caovuottroi @HùngCườngCompany Smarta Grow mua ngay' }),
    DEFAULT_RULE
  );
  assert.strictEqual(evalRes.businessResult, 'FAILED');
  assert.strictEqual(evalRes.dk1.status, 'FAILED');
  console.log('✓ computeEvaluation: FAILED case (short video)');

  // NEEDS_REVIEW case (missing duration)
  evalRes = computeEvaluation(
    makeScrape({ durationSeconds: null }),
    DEFAULT_RULE
  );
  assert.strictEqual(evalRes.businessResult, 'NEEDS_REVIEW');
  assert.strictEqual(evalRes.dk1.passed, null);
  console.log('✓ computeEvaluation: NEEDS_REVIEW case (missing duration)');

  // INACCESSIBLE case
  evalRes = computeEvaluation(
    makeScrape({ success: false, accessState: 'DELETED' }),
    DEFAULT_RULE
  );
  assert.strictEqual(evalRes.businessResult, 'INACCESSIBLE');
  console.log('✓ computeEvaluation: INACCESSIBLE case (deleted post)');

  // PROCESSING_ERROR case (captcha)
  evalRes = computeEvaluation(
    makeScrape({ success: false, accessState: 'CAPTCHA' }),
    DEFAULT_RULE
  );
  assert.strictEqual(evalRes.businessResult, 'PROCESSING_ERROR');
  assert.strictEqual(evalRes.needsManualReview, true);
  console.log('✓ computeEvaluation: PROCESSING_ERROR case (captcha → job should pause)');

  // AI JSON error / invalid → NEEDS_REVIEW (not bypass to PASSED)
  evalRes = computeEvaluation(
    makeScrape({ durationSeconds: null }),
    DEFAULT_RULE,
    null  // AI analysis failed/missing
  );
  assert.strictEqual(evalRes.businessResult, 'NEEDS_REVIEW', 'Missing data with no AI should be NEEDS_REVIEW');
  console.log('✓ computeEvaluation: AI missing/failed → NEEDS_REVIEW (not bypassed to PASSED)');

  console.log('✓ All Decision Engine tests passed!\n');
}
