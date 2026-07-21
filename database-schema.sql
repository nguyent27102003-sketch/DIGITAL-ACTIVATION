-- =============================================================================
-- FBEVAL V2.1 COMPLETE DATABASE SCHEMA (13 TABLES)
-- Specification: FBEVAL-MANDATORY-IMPLEMENTATION-SPEC-V2.1
-- Generated for Gate 1 Runtime Verification Baseline
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -----------------------------------------------------------------------------
-- 1. CAMPAIGNS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'ARCHIVED', 'PAUSED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 2. CAMPAIGN RULES (versioned, immutable after confirmation)
-- -----------------------------------------------------------------------------
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
  require_cta INTEGER NOT NULL DEFAULT 1 CHECK(require_cta IN (0, 1)),
  accepted_ctas TEXT NOT NULL DEFAULT '[]',
  allow_semantic_cta INTEGER NOT NULL DEFAULT 1 CHECK(allow_semantic_cta IN (0, 1)),
  allow_hashtag_in_comments INTEGER NOT NULL DEFAULT 0 CHECK(allow_hashtag_in_comments IN (0, 1)),
  allow_tag_in_comments INTEGER NOT NULL DEFAULT 0 CHECK(allow_tag_in_comments IN (0, 1)),
  unknown_data_policy TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(unknown_data_policy IN ('NEEDS_REVIEW', 'FAIL', 'PASS')),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0, 1)),
  confirmed_at TEXT,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 3. EXCEL FILES (originals preserved, never modified)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS excel_files (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 4. EXCEL MAPPINGS (confirmed mapping specifications)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS excel_mappings (
  id TEXT PRIMARY KEY,
  excel_file_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  header_row INTEGER NOT NULL DEFAULT 1,
  data_start_row INTEGER NOT NULL DEFAULT 2,
  mapping_type TEXT NOT NULL DEFAULT 'SINGLE_SESSION' CHECK(mapping_type IN ('SINGLE_SESSION', 'MULTI_SESSION')),
  columns_json TEXT NOT NULL DEFAULT '{}',
  sessions_json TEXT NOT NULL DEFAULT '[]',
  confidence_json TEXT NOT NULL DEFAULT '{}',
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0, 1)),
  confirmed_at TEXT,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(excel_file_id) REFERENCES excel_files(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 5. JOBS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  campaign_rule_id TEXT NOT NULL,
  excel_file_id TEXT NOT NULL,
  excel_mapping_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'READY', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'COMPLETED_WITH_REVIEW', 'FAILED')),
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  passed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  review_items INTEGER NOT NULL DEFAULT 0,
  error_items INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
  pause_requested INTEGER NOT NULL DEFAULT 0 CHECK(pause_requested IN (0, 1)),
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

-- -----------------------------------------------------------------------------
-- 6. JOB ITEMS
-- technical_status: PENDING, PROCESSING, RETRYING, COMPLETED, PROCESSING_ERROR, CANCELLED
-- business_result: PASSED, FAILED, NEEDS_REVIEW, INACCESSIBLE, NULL
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  workbook_id TEXT,
  sheet_name TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  session_key TEXT NOT NULL DEFAULT 'session_1',
  source_url TEXT NOT NULL,
  normalized_url TEXT,
  final_resolved_url TEXT,
  platform TEXT NOT NULL DEFAULT 'FACEBOOK' CHECK(platform IN ('FACEBOOK', 'TIKTOK', 'YOUTUBE', 'UNKNOWN')),
  fanpage_url TEXT,
  source_url_cell TEXT,
  target_cells_json TEXT,
  region TEXT,
  customer_code TEXT,
  customer_name TEXT,
  technical_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(technical_status IN ('PENDING', 'PROCESSING', 'RETRYING', 'COMPLETED', 'PROCESSING_ERROR', 'CANCELLED')),
  business_result TEXT CHECK(business_result IN ('PASSED', 'FAILED', 'NEEDS_REVIEW', 'INACCESSIBLE') OR business_result IS NULL),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at TEXT,
  locked_by TEXT,
  locked_at TEXT,
  heartbeat_at TEXT,
  idempotency_key TEXT UNIQUE,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_items_idempotency ON job_items(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_job_items_status ON job_items(job_id, technical_status);

-- -----------------------------------------------------------------------------
-- 7. SCRAPE RESULTS
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 8. EVALUATION RESULTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluation_results (
  id TEXT PRIMARY KEY,
  job_item_id TEXT NOT NULL UNIQUE,
  dk1_passed INTEGER CHECK(dk1_passed IN (0, 1) OR dk1_passed IS NULL),
  dk1_reason TEXT,
  dk2_passed INTEGER CHECK(dk2_passed IN (0, 1) OR dk2_passed IS NULL),
  dk2_reason TEXT,
  dk2_detail_json TEXT,
  overall_result TEXT NOT NULL CHECK(overall_result IN ('PASSED', 'FAILED', 'NEEDS_REVIEW', 'INACCESSIBLE')),
  confidence REAL NOT NULL DEFAULT 1.0,
  needs_manual_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_manual_review IN (0, 1)),
  review_reasons_json TEXT,
  feedback TEXT,
  ai_contribution_json TEXT,
  evaluated_at TEXT NOT NULL,
  FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- 9. EVIDENCE FILES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  job_item_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_url TEXT NOT NULL,
  resolved_url TEXT,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN ('CONTENT', 'ENGAGEMENT')),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT,
  file_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  file_size INTEGER,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE,
  CONSTRAINT unq_evidence_item_type UNIQUE (job_item_id, evidence_type)
);

CREATE INDEX IF NOT EXISTS idx_evidence_item ON evidence_files(job_item_id);

-- -----------------------------------------------------------------------------
-- 10. MANUAL REVIEWS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual_reviews (
  id TEXT PRIMARY KEY,
  job_item_id TEXT NOT NULL,
  original_evaluation_result_id TEXT,
  reviewer_user_id TEXT NOT NULL DEFAULT 'USER',
  actor_type TEXT NOT NULL DEFAULT 'USER',
  review_sequence INTEGER NOT NULL DEFAULT 1,
  previous_result TEXT NOT NULL,
  new_result TEXT NOT NULL CHECK(new_result IN ('PASSED', 'FAILED', 'NEEDS_REVIEW', 'INACCESSIBLE')),
  previous_dk1 INTEGER,
  new_dk1 INTEGER,
  previous_dk2 INTEGER,
  new_dk2 INTEGER,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_item_id) REFERENCES job_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_reviews_item ON manual_reviews(job_item_id);

-- -----------------------------------------------------------------------------
-- 11. AUDIT LOGS
-- -----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- 12. NOTIFICATIONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  job_id TEXT,
  job_item_id TEXT,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'INFO' CHECK(level IN ('INFO', 'WARNING', 'ERROR', 'SUCCESS')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  action_url TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
  read_at TEXT,
  dedupe_key TEXT UNIQUE,
  delivery_status TEXT DEFAULT 'PENDING' CHECK(delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key);

-- -----------------------------------------------------------------------------
-- 13. AI REQUESTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  job_id TEXT,
  job_item_id TEXT,
  task_type TEXT NOT NULL CHECK(task_type IN ('POSTER_EXTRACTION', 'CAPTION_ANALYSIS', 'OCR_FALLBACK', 'CHAT')),
  requested_provider TEXT NOT NULL DEFAULT '9router',
  actual_provider TEXT,
  requested_model TEXT,
  actual_model TEXT,
  route_name TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  input_hash TEXT,
  output_hash TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED', 'TIMEOUT', 'INVALID_JSON', 'SCHEMA_ERROR')),
  error_code TEXT,
  error_message TEXT,
  token_count INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_job ON ai_requests(job_id, job_item_id);

-- -----------------------------------------------------------------------------
-- 14. USERS (Google Auth & Access Control)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_subject TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN', 'OPERATOR', 'VIEWER')),
    approval_status TEXT NOT NULL CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
    account_status TEXT NOT NULL CHECK(account_status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
    approved_by TEXT,
    approved_at TEXT,
    rejection_reason TEXT,
    suspended_reason TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- -----------------------------------------------------------------------------
-- 15. USER SESSIONS (HttpOnly Secure Sessions)
-- -----------------------------------------------------------------------------
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

