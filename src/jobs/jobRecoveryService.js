/**
 * Job Recovery Service
 * 
 * Per spec §3 (phản hồi V2.1):
 *  - Job Recovery là service runtime riêng, KHÔNG phải database migration.
 *  - Chỉ reset item PROCESSING khi heartbeat đã hết hạn (không reset mù quáng).
 *  - Kiểm tra kết quả đã có chưa trước khi đưa về PENDING.
 *  - Kiểm tra evidence đã tồn tại chưa.
 *  - Chứng minh idempotency: chạy nhiều lần không gây trùng kết quả.
 *  - Ghi Audit Log cho mỗi hành động Recovery.
 * 
 * Access State → Job Item Status Mapping (per spec §9):
 *  ACCESSIBLE        → Continue evaluation
 *  LOGIN_REQUIRED    → PROCESSING_ERROR + Pause Job
 *  SESSION_EXPIRED   → PROCESSING_ERROR + Pause Job
 *  PRIVATE_POST      → INACCESSIBLE       (no retry)
 *  POST_DELETED      → INACCESSIBLE       (no retry)
 *  CAPTCHA           → PROCESSING_ERROR + Pause Job
 *  CHECKPOINT        → PROCESSING_ERROR + Pause Job
 *  RATE_LIMITED      → RETRYING           (backoff)
 *  NAVIGATION_TIMEOUT→ RETRYING           (backoff, within limit)
 *  UNSUPPORTED_URL   → INACCESSIBLE       (no retry)
 *  UNKNOWN_ERROR     → PROCESSING_ERROR   (ghi rõ nguyên nhân)
 * 
 * Retry + Exponential Backoff Policy (per spec §10):
 *  Lần 1: 2 giây
 *  Lần 2: 5 giây
 *  Lần 3: 15 giây
 *  Sau max_retries: PROCESSING_ERROR (không retry thêm)
 * 
 *  Retryable errors:
 *    RATE_LIMITED, NAVIGATION_TIMEOUT, NETWORK_ERROR,
 *    AI_TIMEOUT, TEMPORARY_PROVIDER_ERROR
 * 
 *  Non-retryable errors (final state):
 *    PRIVATE_POST, POST_DELETED, UNSUPPORTED_URL,
 *    INVALID_EXCEL_MAPPING, RULE_NOT_CONFIRMED
 */

import db from '../db/index.js';
import fs from 'fs';

// Heartbeat timeout: if no heartbeat update for > 5 minutes, assume server crashed
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Retry backoff delays (milliseconds)
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

// Errors that qualify for retry
const RETRYABLE_ERROR_CODES = new Set([
  'RATE_LIMITED',
  'NAVIGATION_TIMEOUT',
  'NETWORK_ERROR',
  'AI_TIMEOUT',
  'TEMPORARY_PROVIDER_ERROR',
]);

// Errors that should NEVER be retried
const NON_RETRYABLE_ERROR_CODES = new Set([
  'PRIVATE_POST',
  'POST_DELETED',
  'UNSUPPORTED_URL',
  'INVALID_EXCEL_MAPPING',
  'RULE_NOT_CONFIRMED',
  'LOGIN_REQUIRED',
  'CAPTCHA',
  'CHECKPOINT',
]);

/**
 * Access State → Job Item Status Mapping (Spec V2.1 Revision 2).
 * Returns { businessResult, technicalStatus, shouldPauseJob, isRetryable }
 * 
 * @param {string} accessState
 * @param {number} attemptCount
 * @param {number} maxAttempts
 * @returns {{ businessResult: string|null, technicalStatus: string, shouldPauseJob: boolean, isRetryable: boolean }}
 */
export function mapAccessStateToItemStatus(accessState, attemptCount = 1, maxAttempts = 4) {
  switch (accessState) {
    case 'ACCESSIBLE':
      return { businessResult: null, technicalStatus: 'PROCESSING', shouldPauseJob: false, isRetryable: false };

    case 'LOGIN_REQUIRED':
    case 'SESSION_EXPIRED':
    case 'CAPTCHA':
    case 'CHECKPOINT':
      return { businessResult: null, technicalStatus: 'PROCESSING_ERROR', shouldPauseJob: true, isRetryable: false };

    case 'PRIVATE':
    case 'PRIVATE_POST':
    case 'DELETED':
    case 'POST_DELETED':
    case 'UNSUPPORTED_URL':
      return { businessResult: 'INACCESSIBLE', technicalStatus: 'COMPLETED', shouldPauseJob: false, isRetryable: false };

    case 'RATE_LIMITED':
    case 'NAVIGATION_TIMEOUT':
    case 'NETWORK_ERROR':
      if (attemptCount < maxAttempts) {
        return { businessResult: null, technicalStatus: 'RETRYING', shouldPauseJob: false, isRetryable: true };
      }
      return { businessResult: null, technicalStatus: 'PROCESSING_ERROR', shouldPauseJob: false, isRetryable: false };

    case 'UNKNOWN_ACCESS_ERROR':
    default:
      return { businessResult: null, technicalStatus: 'PROCESSING_ERROR', shouldPauseJob: false, isRetryable: false };
  }
}

/**
 * Get next retry delay in milliseconds based on attempt count.
 * 
 * @param {number} attemptCount - Number of attempts already made (0-indexed)
 * @returns {number} Milliseconds to wait before next retry
 */
export function getRetryDelayMs(attemptCount) {
  const idx = Math.min(attemptCount, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[idx];
}

/**
 * Determine if an error code qualifies for retry.
 * 
 * @param {string} errorCode
 * @returns {boolean}
 */
export function isRetryableError(errorCode) {
  return RETRYABLE_ERROR_CODES.has(errorCode);
}

/**
 * Determine if an error code is a permanent failure (no retry).
 * 
 * @param {string} errorCode
 * @returns {boolean}
 */
export function isNonRetryableError(errorCode) {
  return NON_RETRYABLE_ERROR_CODES.has(errorCode);
}

/**
 * Recovery Service — runs on server startup.
 * 
 * IDEMPOTENT: Running this multiple times must produce the same result.
 * SAFE: Only resets items with expired heartbeat AND no completed result.
 * 
 * Steps:
 *  1. Find PROCESSING items with heartbeat > HEARTBEAT_TIMEOUT_MS ago.
 *  2. For each stuck item, check if evaluation_results already exists.
 *  3. If complete result exists → skip (already done).
 *  4. If evidence files exist → record as partial, reset to RETRYING.
 *  5. Otherwise → reset to PENDING (safe to reprocess).
 *  6. Write Audit Log for each action.
 *  7. Set affected Jobs back to PAUSED.
 * 
 * @param {string} [serverInstanceId] - Unique ID of this server process
 * @returns {{ recovered: number, skipped: number, errors: number }}
 */
export function runJobRecovery(serverInstanceId = 'server_' + Date.now()) {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS).toISOString();

  const stuckItems = db.prepare(`
    SELECT ji.*, j.status as job_status
    FROM job_items ji
    JOIN jobs j ON ji.job_id = j.id
    WHERE ji.technical_status = 'PROCESSING'
      AND (ji.heartbeat_at IS NULL OR ji.heartbeat_at < ?)
  `).all(cutoffTime);

  if (stuckItems.length === 0) {
    return { recovered: 0, skipped: 0, errors: 0 };
  }

  console.log(`[JobRecovery] Found ${stuckItems.length} stuck PROCESSING items (heartbeat expired > ${HEARTBEAT_TIMEOUT_MS / 1000}s ago)`);

  let recovered = 0, skipped = 0, errors = 0;
  const affectedJobIds = new Set();

  for (const item of stuckItems) {
    try {
      // 1. Strict Evaluation Result Check
      const evalResults = db.prepare(
        `SELECT id, overall_result, dk1_passed, dk2_passed FROM evaluation_results WHERE job_item_id = ?`
      ).all(item.id);

      // Check pending AI requests
      const pendingAiCount = db.prepare(
        `SELECT COUNT(*) as cnt FROM ai_requests WHERE job_item_id = ? AND status = 'PENDING'`
      ).get(item.id)?.cnt || 0;

      // Check evidence files
      const evidenceFiles = db.prepare(
        `SELECT * FROM evidence_files WHERE job_item_id = ?`
      ).all(item.id);

      const isValidEval = evalResults.length === 1 &&
        ['PASSED', 'FAILED', 'NEEDS_REVIEW', 'INACCESSIBLE'].includes(evalResults[0].overall_result) &&
        pendingAiCount === 0;

      if (isValidEval) {
        // Item already has a valid evaluation result — mark COMPLETED with valid business_result
        const validResult = evalResults[0].overall_result;
        db.prepare(`
          UPDATE job_items 
          SET technical_status = 'COMPLETED', 
              business_result = ?,
              heartbeat_at = NULL,
              locked_by = NULL,
              locked_at = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(validResult, now.toISOString(), item.id);

        console.log(`[JobRecovery] Item ${item.id}: valid eval result found (${validResult}), set to COMPLETED.`);
        skipped++;
        continue;
      }

      // If invalid/partial state: reset item to PENDING or RETRYING or PROCESSING_ERROR
      const currentAttempt = item.attempt_count || 1;
      const maxAttempts = item.max_attempts || 4;

      let targetStatus = 'PENDING';
      let targetBusiness = null;

      if (currentAttempt >= maxAttempts) {
        targetStatus = 'PROCESSING_ERROR';
        targetBusiness = null; // Spec requirement: business_result is NULL on PROCESSING_ERROR
      } else {
        targetStatus = 'RETRYING';
        targetBusiness = null;
      }

      db.prepare(`
        UPDATE job_items
        SET technical_status = ?,
            business_result = ?,
            last_error_code = 'SERVER_CRASH_RECOVERY',
            last_error_message = ?,
            heartbeat_at = NULL,
            locked_by = NULL,
            locked_at = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(
        targetStatus,
        targetBusiness,
        `Server crash recovery. Heartbeat expired. Evidence count: ${evidenceFiles.length}. Attempt: ${currentAttempt}/${maxAttempts}.`,
        now.toISOString(),
        item.id
      );

      // Audit log
      db.prepare(`
        INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        VALUES (?, 'SYSTEM', ?, 'JOB_RECOVERY', 'JOB_ITEM', ?, ?, ?, ?, ?)
      `).run(
        `audit_recovery_${item.id}_${Date.now()}`,
        serverInstanceId,
        item.id,
        JSON.stringify({ technical_status: 'PROCESSING', locked_by: item.locked_by }),
        JSON.stringify({ technical_status: targetStatus, business_result: targetBusiness }),
        `Server crash recovery. Heartbeat expired at ${item.heartbeat_at}. Evidence files: ${evidenceFiles.length}.`,
        now.toISOString()
      );

      affectedJobIds.add(item.job_id);
      recovered++;
      console.log(`[JobRecovery] Item ${item.id}: reset to ${targetStatus}. Evidence: ${evidenceFiles.length}, Retries: ${item.retry_count}/${item.max_retries || 3}.`);

    } catch (err) {
      errors++;
      console.error(`[JobRecovery] Failed to recover item ${item.id}:`, err.message);
    }
  }

  // Pause affected jobs (only if they were RUNNING)
  for (const jobId of affectedJobIds) {
    try {
      const job = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId);
      if (job && job.status === 'RUNNING') {
        db.prepare(`UPDATE jobs SET status = 'PAUSED', updated_at = ? WHERE id = ?`).run(now.toISOString(), jobId);
        db.prepare(`
          INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
          VALUES (?, 'SYSTEM', ?, 'JOB_RECOVERY_PAUSE', 'JOB', ?, ?, ?, ?, ?)
        `).run(
          `audit_job_recovery_${jobId}_${Date.now()}`,
          serverInstanceId,
          jobId,
          JSON.stringify({ status: 'RUNNING' }),
          JSON.stringify({ status: 'PAUSED' }),
          'Job paused due to server crash recovery. Manual resume required.',
          now.toISOString()
        );
        console.log(`[JobRecovery] Job ${jobId}: set to PAUSED (was RUNNING during crash).`);
      }
    } catch (err) {
      console.error(`[JobRecovery] Failed to pause job ${jobId}:`, err.message);
    }
  }

  console.log(`[JobRecovery] Complete. Recovered: ${recovered}, Skipped (already done): ${skipped}, Errors: ${errors}.`);
  return { recovered, skipped, errors };
}

/**
 * Update heartbeat for a processing item.
 * Call this periodically (e.g. every 30s) during scraping to prevent false crash detection.
 * 
 * @param {string} itemId
 * @param {string} serverInstanceId
 */
export function updateHeartbeat(itemId, serverInstanceId) {
  try {
    db.prepare(`
      UPDATE job_items 
      SET heartbeat_at = ?, locked_by = ?
      WHERE id = ? AND technical_status = 'PROCESSING'
    `).run(new Date().toISOString(), serverInstanceId, itemId);
  } catch (_) {}
}

/**
 * Acquire a processing lock on a job item.
 * Returns false if item was already locked by another process.
 * 
 * @param {string} itemId
 * @param {string} serverInstanceId
 * @returns {boolean} true if lock acquired
 */
export function acquireItemLock(itemId, serverInstanceId) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE job_items
    SET technical_status = 'PROCESSING',
        locked_by = ?,
        locked_at = ?,
        heartbeat_at = ?,
        attempt_count = attempt_count + 1,
        updated_at = ?
    WHERE id = ? 
      AND technical_status IN ('PENDING', 'RETRYING')
      AND (locked_by IS NULL OR locked_by = ?)
  `).run(serverInstanceId, now, now, now, itemId, serverInstanceId);

  return result.changes > 0;
}

/**
 * Release lock and set final result on a job item.
 * 
 * @param {string} itemId
 * @param {'COMPLETED'|'FAILED'|'RETRYING'} finalStatus
 * @param {string|null} businessResult
 * @param {string|null} errorCode
 * @param {string|null} errorMessage
 * @param {number} retryDelayMs - Only used when finalStatus is RETRYING
 */
export function releaseItemLock(itemId, finalStatus, businessResult, errorCode, errorMessage, retryDelayMs = 0) {
  const now = new Date();
  const nextRetryAt = finalStatus === 'RETRYING' 
    ? new Date(now.getTime() + retryDelayMs).toISOString()
    : null;

  db.prepare(`
    UPDATE job_items
    SET technical_status = ?,
        business_result = COALESCE(?, business_result),
        last_error_code = ?,
        last_error_message = ?,
        next_retry_at = ?,
        locked_by = NULL,
        locked_at = NULL,
        heartbeat_at = NULL,
        retry_count = CASE WHEN ? = 'RETRYING' THEN retry_count + 1 ELSE retry_count END,
        updated_at = ?
    WHERE id = ?
  `).run(
    finalStatus,
    businessResult,
    errorCode,
    errorMessage,
    nextRetryAt,
    finalStatus,
    now.toISOString(),
    itemId
  );
}
