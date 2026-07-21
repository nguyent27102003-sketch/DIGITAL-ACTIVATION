import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const dataDir = path.join(rootDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'fbeval.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    -- ──────────────────────────────────────────────
    -- CAMPAIGNS
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- ──────────────────────────────────────────────
    -- CAMPAIGN RULES (versioned, immutable after confirmation)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS campaign_rules (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      rule_version INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      product_names TEXT NOT NULL DEFAULT '[]',
      required_hashtags TEXT NOT NULL DEFAULT '[]',
      required_tags TEXT NOT NULL DEFAULT '[]',
      min_video_duration_sec INTEGER NOT NULL DEFAULT 30,
      min_livestream_duration_sec INTEGER NOT NULL DEFAULT 900,
      require_cta INTEGER NOT NULL DEFAULT 1,
      accepted_ctas TEXT NOT NULL DEFAULT '[]',
      allow_semantic_cta INTEGER NOT NULL DEFAULT 1,
      allow_hashtag_in_comments INTEGER NOT NULL DEFAULT 0,
      allow_tag_in_comments INTEGER NOT NULL DEFAULT 0,
      unknown_data_policy TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
      confirmed INTEGER NOT NULL DEFAULT 0,
      confirmed_at TEXT,
      confirmed_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- EXCEL FILES (originals preserved, never modified)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS excel_files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      row_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- ──────────────────────────────────────────────
    -- EXCEL MAPPINGS (confirmed by user before Job)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS excel_mappings (
      id TEXT PRIMARY KEY,
      excel_file_id TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      header_row INTEGER NOT NULL DEFAULT 1,
      data_start_row INTEGER NOT NULL DEFAULT 2,
      mapping_type TEXT NOT NULL DEFAULT 'SINGLE_SESSION',
      columns_json TEXT NOT NULL DEFAULT '{}',
      sessions_json TEXT NOT NULL DEFAULT '[]',
      confidence_json TEXT NOT NULL DEFAULT '{}',
      confirmed INTEGER NOT NULL DEFAULT 0,
      confirmed_at TEXT,
      confirmed_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(excel_file_id) REFERENCES excel_files(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- JOBS
    -- Valid status: DRAFT, READY, RUNNING, PAUSING, PAUSED,
    --              CANCELLING, CANCELLED, COMPLETED,
    --              COMPLETED_WITH_REVIEW, FAILED
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      campaign_rule_id TEXT NOT NULL,
      excel_file_id TEXT NOT NULL,
      excel_mapping_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      total_items INTEGER NOT NULL DEFAULT 0,
      processed_items INTEGER NOT NULL DEFAULT 0,
      passed_items INTEGER NOT NULL DEFAULT 0,
      failed_items INTEGER NOT NULL DEFAULT 0,
      review_items INTEGER NOT NULL DEFAULT 0,
      error_items INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      pause_requested INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY(campaign_rule_id) REFERENCES campaign_rules(id),
      FOREIGN KEY(excel_file_id) REFERENCES excel_files(id),
      FOREIGN KEY(excel_mapping_id) REFERENCES excel_mappings(id)
    );

    -- ──────────────────────────────────────────────
    -- JOB ITEMS
    -- Valid technical_status: PENDING, PROCESSING, RETRYING,
    --                         COMPLETED, FAILED, CANCELLED
    -- Valid business_result: PASSED, FAILED, NEEDS_REVIEW,
    --                        INACCESSIBLE, PROCESSING_ERROR,
    --                        CANCELLED, NOT_SUBMITTED
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      workbook_id TEXT,
      sheet_name TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      session_key TEXT DEFAULT 'session_1',
      source_url_cell TEXT,              -- e.g. "U18" (exact column+row of URL cell)
      target_cells_json TEXT,            -- JSON: {dk1:"V18", dk2:"W18", result:"X18", ...}
      region TEXT,                       -- NULL allowed; from Excel only; no fallback value
      customer_code TEXT,                -- NULL allowed; from Excel only
      customer_name TEXT,                -- NULL allowed; from Excel only
      fanpage_url TEXT,
      source_url TEXT NOT NULL,
      normalized_url TEXT,
      final_resolved_url TEXT,
      platform TEXT NOT NULL DEFAULT 'FACEBOOK',
      technical_status TEXT NOT NULL DEFAULT 'PENDING',
      business_result TEXT,
      -- Retry / Lease / Idempotency fields
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 4,
      last_error_code TEXT,
      last_error_message TEXT,
      next_retry_at TEXT,
      locked_by TEXT,                    -- server instance ID
      locked_at TEXT,                    -- when lock was acquired
      heartbeat_at TEXT,                 -- updated every N seconds during processing
      idempotency_key TEXT,              -- SHA-256 of (job_id + source_url + session_key)
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- SCRAPE RESULTS (raw captured data with source tracking)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scrape_results (
      id TEXT PRIMARY KEY,
      job_item_id TEXT NOT NULL UNIQUE,
      access_state TEXT NOT NULL DEFAULT 'ACCESSIBLE',
      post_type TEXT,
      duration_seconds INTEGER,
      duration_source TEXT,
      caption_text TEXT,
      caption_source TEXT,
      total_reactions INTEGER,
      likes INTEGER,
      comments INTEGER,
      shares INTEGER,
      views INTEGER,
      metrics_source TEXT,
      page_name TEXT,
      page_url TEXT,
      raw_metrics_json TEXT NOT NULL DEFAULT '{}',
      extracted_at TEXT NOT NULL,
      FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- EVALUATION RESULTS (deterministic, never AI-only)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS evaluation_results (
      id TEXT PRIMARY KEY,
      job_item_id TEXT NOT NULL UNIQUE,
      dk1_passed INTEGER,
      dk1_reason TEXT,
      dk2_passed INTEGER,
      dk2_reason TEXT,
      dk2_detail_json TEXT,
      overall_result TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      needs_manual_review INTEGER NOT NULL DEFAULT 0,
      review_reasons_json TEXT,
      feedback TEXT,
      ai_contribution_json TEXT,
      evaluated_at TEXT NOT NULL,
      FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- EVIDENCE FILES
    -- evidence_type MUST be: CONTENT or ENGAGEMENT
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS evidence_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_item_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      source_url TEXT NOT NULL,
      resolved_url TEXT,
      evidence_type TEXT NOT NULL CHECK(evidence_type IN ('CONTENT','ENGAGEMENT')),
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT,
      file_hash TEXT NOT NULL,           -- SHA-256 of actual file contents
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      file_size INTEGER,
      captured_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- MANUAL REVIEWS (immutable history, never delete)
    -- reason is NOT NULL — cannot save without reason
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS manual_reviews (
      id TEXT PRIMARY KEY,
      job_item_id TEXT NOT NULL,
      original_evaluation_result_id TEXT,   -- reference to evaluation_results.id
      reviewer_user_id TEXT NOT NULL DEFAULT 'USER',
      actor_type TEXT NOT NULL DEFAULT 'USER',
      review_sequence INTEGER NOT NULL DEFAULT 1,
      previous_result TEXT NOT NULL,
      new_result TEXT NOT NULL,
      previous_dk1 INTEGER,
      new_dk1 INTEGER,
      previous_dk2 INTEGER,
      new_dk2 INTEGER,
      reason TEXT NOT NULL,
      before_json TEXT NOT NULL,           -- full snapshot of eval before override
      after_json TEXT NOT NULL,            -- full snapshot of eval after override
      reviewed_at TEXT NOT NULL,
      FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
    );

    -- ──────────────────────────────────────────────
    -- AUDIT LOGS (append-only, never update/delete)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL DEFAULT 'SYSTEM',
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    -- ──────────────────────────────────────────────
    -- NOTIFICATIONS (in-app center + Web Push)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      job_id TEXT,
      job_item_id TEXT,
      type TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'INFO',  -- INFO, WARNING, ERROR, SUCCESS
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      action_url TEXT,                     -- deep link to correct screen
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      dedupe_key TEXT,                     -- prevents duplicate notifications
      delivery_status TEXT DEFAULT 'PENDING',  -- PENDING, SENT, FAILED
      delivered_at TEXT,
      created_at TEXT NOT NULL
    );

    -- ──────────────────────────────────────────────
    -- AI REQUESTS (full audit trail for all AI calls)
    -- job_item_id is nullable (poster extraction has no job yet)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ai_requests (
      id TEXT PRIMARY KEY,
      campaign_id TEXT,
      job_id TEXT,
      job_item_id TEXT,                    -- NULL allowed for poster/chat tasks
      task_type TEXT NOT NULL,             -- POSTER_EXTRACTION, CAPTION_ANALYSIS, OCR_FALLBACK, CHAT
      requested_provider TEXT NOT NULL DEFAULT '9router',
      actual_provider TEXT,               -- may differ if 9Router fallback occurs
      requested_model TEXT,
      actual_model TEXT,                   -- may differ if 9Router substitutes
      route_name TEXT,                     -- 9Router route identifier
      prompt_version TEXT,
      schema_version TEXT,
      input_hash TEXT,                     -- SHA-256 of prompt content
      output_hash TEXT,                    -- SHA-256 of raw AI response
      latency_ms INTEGER,
      status TEXT NOT NULL,                -- SUCCESS, FAILED, TIMEOUT, INVALID_JSON, SCHEMA_ERROR
      error_code TEXT,
      error_message TEXT,
      token_count INTEGER,
      created_at TEXT NOT NULL
    );

    -- ──────────────────────────────────────────────
    -- USERS (Google Auth & Access Control per FBEval V2.1 Spec)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'VIEWER' CHECK(role IN ('SUPER_ADMIN', 'OPERATOR', 'VIEWER')),
      approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
      account_status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(account_status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
      approved_by TEXT,
      approved_at TEXT,
      rejection_reason TEXT,
      suspended_reason TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );

    -- ──────────────────────────────────────────────
    -- USER SESSIONS (HttpOnly Secure Session Hashes)
    -- ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_hash TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key);
  `);

  runMigrations();
  ensureOwnerUser();
}

/**
 * Auto-provision System Owner nq.thien27@gmail.com as SUPER_ADMIN, APPROVED, ACTIVE
 */
export function ensureOwnerUser() {
  const ownerEmail = (process.env.SYSTEM_OWNER_EMAIL || 'nq.thien27@gmail.com').trim().toLowerCase();
  try {
    const owner = db.prepare(`SELECT * FROM users WHERE email = ?`).get(ownerEmail);
    const now = new Date().toISOString();
    if (!owner) {
      db.prepare(`
        INSERT INTO users (
          id, google_subject, email, display_name, avatar_url,
          role, approval_status, account_status, created_at, updated_at, approved_at, approved_by
        ) VALUES (?, ?, ?, ?, ?, 'SUPER_ADMIN', 'APPROVED', 'ACTIVE', ?, ?, ?, ?)
      `).run(
        'usr_super_admin_owner',
        'google_sub_owner_thien',
        ownerEmail,
        'Nguyễn Quang Thiện',
        'https://lh3.googleusercontent.com/a/default-user',
        now,
        now,
        now,
        'SYSTEM'
      );
    } else {
      // Ensure owner is ALWAYS SUPER_ADMIN, APPROVED, ACTIVE (protection against demotion/lock)
      db.prepare(`
        UPDATE users 
        SET role = 'SUPER_ADMIN', approval_status = 'APPROVED', account_status = 'ACTIVE', updated_at = ?
        WHERE email = ?
      `).run(now, ownerEmail);
    }
  } catch (err) {
    console.error('[DB Init] Failed to ensure owner user:', err.message);
  }
}

/**
 * Schema-only migrations. NEVER put runtime logic here.
 * Job Recovery is handled in src/jobs/jobRecoveryService.js
 */
function runMigrations() {
  const columnMigrations = [
    // job_items — lease, heartbeat, idempotency, retry policy
    `ALTER TABLE job_items ADD COLUMN source_url_cell TEXT`,
    `ALTER TABLE job_items ADD COLUMN target_cells_json TEXT`,
    `ALTER TABLE job_items ADD COLUMN last_error_code TEXT`,
    `ALTER TABLE job_items ADD COLUMN last_error_message TEXT`,
    `ALTER TABLE job_items ADD COLUMN next_retry_at TEXT`,
    `ALTER TABLE job_items ADD COLUMN locked_by TEXT`,
    `ALTER TABLE job_items ADD COLUMN locked_at TEXT`,
    `ALTER TABLE job_items ADD COLUMN heartbeat_at TEXT`,
    `ALTER TABLE job_items ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE job_items ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 4`,
    `ALTER TABLE job_items ADD COLUMN idempotency_key TEXT`,
    // evidence_files — full spec
    `ALTER TABLE evidence_files ADD COLUMN file_name TEXT`,
    `ALTER TABLE evidence_files ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'image/png'`,
    `ALTER TABLE evidence_files ADD COLUMN file_size INTEGER`,
    `ALTER TABLE evidence_files ADD COLUMN created_at TEXT`,
    // notifications — full spec
    `ALTER TABLE notifications ADD COLUMN user_id TEXT`,
    `ALTER TABLE notifications ADD COLUMN job_item_id TEXT`,
    `ALTER TABLE notifications ADD COLUMN entity_type TEXT`,
    `ALTER TABLE notifications ADD COLUMN entity_id TEXT`,
    `ALTER TABLE notifications ADD COLUMN read_at TEXT`,
    `ALTER TABLE notifications ADD COLUMN dedupe_key TEXT`,
    `ALTER TABLE notifications ADD COLUMN delivery_status TEXT DEFAULT 'PENDING'`,
    `ALTER TABLE notifications ADD COLUMN delivered_at TEXT`,
    // ai_requests — 9Router provider tracking
    `ALTER TABLE ai_requests ADD COLUMN campaign_id TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN job_id TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN task_type TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN requested_provider TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN actual_provider TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN requested_model TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN actual_model TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN route_name TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN schema_version TEXT`,
    `ALTER TABLE ai_requests ADD COLUMN error_code TEXT`,
    // manual_reviews — full spec
    `ALTER TABLE manual_reviews ADD COLUMN original_evaluation_result_id TEXT`,
    `ALTER TABLE manual_reviews ADD COLUMN reviewer_user_id TEXT`,
    `ALTER TABLE manual_reviews ADD COLUMN before_json TEXT`,
    `ALTER TABLE manual_reviews ADD COLUMN after_json TEXT`,
    // audit_logs
    `ALTER TABLE audit_logs ADD COLUMN ip_address TEXT`,
  ];

  for (const sql of columnMigrations) {
    try { db.exec(sql); } catch (_) {}
  }

  // Check if legacy users table exists without google_subject column or with password_hash constraint
  try {
    const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    if (userCols.length > 0 && (!userCols.includes('google_subject') || userCols.includes('password_hash'))) {
      // Re-create users table safely
      db.exec(`
        CREATE TABLE IF NOT EXISTS users_v2 (
          id TEXT PRIMARY KEY,
          google_subject TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT,
          avatar_url TEXT,
          role TEXT NOT NULL DEFAULT 'VIEWER' CHECK(role IN ('SUPER_ADMIN', 'OPERATOR', 'VIEWER')),
          approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
          account_status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(account_status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
          approved_by TEXT,
          approved_at TEXT,
          rejection_reason TEXT,
          suspended_reason TEXT,
          last_login_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO users_v2 (id, google_subject, email, display_name, role, approval_status, account_status, created_at, updated_at)
        SELECT id, COALESCE(google_subject, 'legacy_' || id), email, COALESCE(full_name, display_name, email), COALESCE(role, 'VIEWER'), COALESCE(status, approval_status, 'PENDING'), 'ACTIVE', COALESCE(created_at, datetime('now')), datetime('now')
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_v2 RENAME TO users;
      `);
    }
  } catch (err) {
    console.error('[DB Migration] Users table migration note:', err.message);
  }

  // Rename legacy columns if they exist (source_cell → source_url_cell)
  // Cannot rename in SQLite — handled by reading both fields in code
}

initDatabase();

export default db;
