/**
 * Unit Tests: Access State Detector
 * Tests detection of login walls, private posts, deleted posts, captcha per spec §8.1.
 */
import assert from 'assert';
import { detectAccessState, mapAccessStateToBusinessResult } from '../src/platforms/accessStateDetector.js';

export async function run() {
  console.log('--- Unit: Access State Detector ---');

  // ── detectAccessState ────────────────────────────────────────────────

  // Normal accessible post
  let state = detectAccessState('https://www.facebook.com/watch/?v=123', 'Facebook Video', 'Bài viết hợp lệ có nội dung', 200);
  assert.strictEqual(state, 'ACCESSIBLE');
  console.log('✓ ACCESSIBLE: normal post');

  // Login wall via URL
  state = detectAccessState('https://www.facebook.com/login/?next=...', 'Log in to Facebook', 'Đăng nhập vào Facebook để xem', 200);
  assert.strictEqual(state, 'LOGIN_REQUIRED');
  console.log('✓ LOGIN_REQUIRED: redirected to login page');

  // Login wall via body text
  state = detectAccessState('https://www.facebook.com/groups/123', 'Facebook', 'Đăng nhập hoặc tạo tài khoản mới', 200);
  assert.strictEqual(state, 'LOGIN_REQUIRED');
  console.log('✓ LOGIN_REQUIRED: login prompt in page body');

  // Deleted post
  state = detectAccessState('https://www.facebook.com/watch/?v=999', 'Facebook', 'Nội dung này hiện không khả dụng', 200);
  assert.strictEqual(state, 'POST_DELETED');
  console.log('✓ POST_DELETED: unavailable content signal');

  // HTTP 404
  state = detectAccessState('https://www.facebook.com/watch/?v=000', 'Not Found', '', 404);
  assert.strictEqual(state, 'POST_DELETED');
  console.log('✓ POST_DELETED: HTTP 404 status');

  // Private post
  state = detectAccessState('https://www.facebook.com/watch/?v=555', 'Facebook', 'Chỉ bạn bè mới xem được bài viết này', 200);
  assert.strictEqual(state, 'PRIVATE_POST');
  console.log('✓ PRIVATE_POST: friends-only post');

  // Captcha
  state = detectAccessState('https://www.facebook.com/challenge/...', 'Facebook', 'Vui lòng hoàn thành xác minh captcha', 200);
  assert.strictEqual(state, 'CAPTCHA');
  console.log('✓ CAPTCHA: captcha challenge detected');

  // Checkpoint
  state = detectAccessState('https://www.facebook.com/checkpoint/1501092823525282/', 'Facebook', 'xác nhận danh tính của bạn', 200);
  assert.strictEqual(state, 'CHECKPOINT');
  console.log('✓ CHECKPOINT: security checkpoint detected');

  // Rate limited
  state = detectAccessState('https://www.facebook.com/watch/?v=789', 'Facebook', 'Tạm thời bị chặn. Hành động bị chặn', 200);
  assert.strictEqual(state, 'RATE_LIMITED');
  console.log('✓ RATE_LIMITED: action blocked signal');

  // ── mapAccessStateToBusinessResult ────────────────────────────────────

  // ACCESSIBLE → no result yet, no job pause
  let mapping = mapAccessStateToBusinessResult('ACCESSIBLE');
  assert.strictEqual(mapping.businessResult, null);
  assert.strictEqual(mapping.shouldPauseJob, false);
  console.log('✓ ACCESSIBLE → businessResult null, no pause');

  // POST_DELETED → INACCESSIBLE, no pause (just mark item)
  mapping = mapAccessStateToBusinessResult('POST_DELETED');
  assert.strictEqual(mapping.businessResult, 'INACCESSIBLE');
  assert.strictEqual(mapping.shouldPauseJob, false);

  mapping = mapAccessStateToBusinessResult('PRIVATE_POST');
  assert.strictEqual(mapping.businessResult, 'INACCESSIBLE');

  mapping = mapAccessStateToBusinessResult('LOGIN_REQUIRED');
  assert.strictEqual(mapping.businessResult, 'PROCESSING_ERROR');
  assert.strictEqual(mapping.shouldPauseJob, true);
  console.log('✓ POST_DELETED/PRIVATE_POST → INACCESSIBLE; LOGIN_REQUIRED → PROCESSING_ERROR, shouldPauseJob=true');

  // CAPTCHA → PROCESSING_ERROR, should pause job
  mapping = mapAccessStateToBusinessResult('CAPTCHA');
  assert.strictEqual(mapping.businessResult, 'PROCESSING_ERROR');
  assert.strictEqual(mapping.shouldPauseJob, true);

  mapping = mapAccessStateToBusinessResult('CHECKPOINT');
  assert.strictEqual(mapping.shouldPauseJob, true);

  mapping = mapAccessStateToBusinessResult('RATE_LIMITED');
  assert.strictEqual(mapping.shouldPauseJob, false);
  console.log('✓ CAPTCHA/CHECKPOINT → shouldPauseJob=true; RATE_LIMITED → backoff retry');

  console.log('✓ All Access State Detector tests passed!\n');
}
