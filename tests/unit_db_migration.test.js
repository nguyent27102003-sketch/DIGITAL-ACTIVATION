import assert from 'assert';
import db from '../src/db/index.js';

export async function run() {
  console.log('Running Unit: Database Migration Test...');

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);

  const expectedTables = [
    'ai_requests',
    'audit_logs',
    'campaign_rules',
    'campaigns',
    'evaluation_results',
    'evidence_files',
    'excel_files',
    'excel_mappings',
    'job_items',
    'jobs',
    'manual_reviews',
    'notifications',
    'scrape_results',
    'user_sessions',
    'users'
  ];

  assert.strictEqual(tables.length, 15, `Expected 15 tables, found ${tables.length}: ${tables.join(', ')}`);
  for (const table of expectedTables) {
    assert.ok(tables.includes(table), `Table ${table} is missing in DB schema.`);
  }

  // Check mandatory columns in job_items
  const jobItemCols = db.prepare(`PRAGMA table_info(job_items)`).all().map(c => c.name);
  const requiredJobItemCols = [
    'id', 'job_id', 'sheet_name', 'source_row', 'session_key',
    'source_url', 'source_url_cell', 'target_cells_json',
    'technical_status', 'business_result', 'locked_by', 'locked_at',
    'heartbeat_at', 'attempt_count', 'max_attempts', 'next_retry_at',
    'idempotency_key', 'last_error_code', 'last_error_message'
  ];

  for (const col of requiredJobItemCols) {
    assert.ok(jobItemCols.includes(col), `Column ${col} is missing in job_items table.`);
  }

  console.log('  ✓ Database Migration verified (15 tables including users & user_sessions, mandatory columns present)');
}
