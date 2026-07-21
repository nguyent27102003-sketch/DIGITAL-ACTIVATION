import assert from 'assert';
import { getRetryDelayMs, isRetryableError, isNonRetryableError } from '../src/jobs/jobRecoveryService.js';

export async function run() {
  console.log('Running Unit: Retry Policy & Backoff Test...');

  // Test Delays: attempt 0 -> 2s, attempt 1 -> 5s, attempt 2 -> 15s
  assert.strictEqual(getRetryDelayMs(0), 2000, 'Attempt 0 delay must be 2000ms');
  assert.strictEqual(getRetryDelayMs(1), 5000, 'Attempt 1 delay must be 5000ms');
  assert.strictEqual(getRetryDelayMs(2), 15000, 'Attempt 2 delay must be 15000ms');

  // Test Retryable Errors
  assert.ok(isRetryableError('RATE_LIMITED'), 'RATE_LIMITED must be retryable');
  assert.ok(isRetryableError('NAVIGATION_TIMEOUT'), 'NAVIGATION_TIMEOUT must be retryable');
  assert.ok(isRetryableError('NETWORK_ERROR'), 'NETWORK_ERROR must be retryable');

  // Test Non-retryable Errors
  assert.ok(isNonRetryableError('LOGIN_REQUIRED'), 'LOGIN_REQUIRED must NOT be retryable');
  assert.ok(isNonRetryableError('PRIVATE_POST'), 'PRIVATE_POST must NOT be retryable');
  assert.ok(isNonRetryableError('POST_DELETED'), 'POST_DELETED must NOT be retryable');
  assert.ok(isNonRetryableError('UNSUPPORTED_URL'), 'UNSUPPORTED_URL must NOT be retryable');

  console.log('  ✓ Retry Policy & Exponential Backoff verified (Delays 2s, 5s, 15s)');
}
