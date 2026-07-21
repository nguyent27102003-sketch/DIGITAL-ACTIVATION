import assert from 'assert';
import db from '../src/db/index.js';
import { runJobRecovery } from '../src/jobs/jobRecoveryService.js';

export async function run() {
  console.log('Running Unit: Job Recovery Idempotency Test...');

  const now = new Date().toISOString();
  const oldHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
  const jobId = `job_rec_test_${Date.now()}`;
  const itemId = `item_rec_test_${Date.now()}`;

  const cId = `c_${Date.now()}`;
  const rId = `r_${Date.now()}`;
  const eId = `e_${Date.now()}`;
  const mId = `m_${Date.now()}`;

  db.prepare(`INSERT INTO campaigns (id, name, created_at, updated_at) VALUES (?, 'Test Campaign', ?, ?)`).run(cId, now, now);
  db.prepare(`INSERT INTO campaign_rules (id, campaign_id, rule_version, name, product_names, required_hashtags, required_tags, created_at) VALUES (?, ?, 1, 'Rule 1', '[]', '[]', '[]', ?)`).run(rId, cId, now);
  db.prepare(`INSERT INTO excel_files (id, original_name, file_path, file_hash, created_at) VALUES (?, 'file.xlsx', 'path', 'hash', ?)`).run(eId, now);
  db.prepare(`INSERT INTO excel_mappings (id, excel_file_id, sheet_name, columns_json, created_at) VALUES (?, ?, 'Sheet1', '{}', ?)`).run(mId, eId, now);

  // Insert dummy job & item stuck in PROCESSING
  db.prepare(`
    INSERT INTO jobs (id, campaign_id, campaign_rule_id, excel_file_id, excel_mapping_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?)
  `).run(jobId, cId, rId, eId, mId, now, now);

  db.prepare(`
    INSERT INTO job_items (id, job_id, sheet_name, source_row, source_url, technical_status, locked_by, locked_at, heartbeat_at, created_at, updated_at)
    VALUES (?, ?, 'Sheet1', 1, 'https://facebook.com/test', 'PROCESSING', 'stale_server', ?, ?, ?, ?)
  `).run(itemId, jobId, oldHeartbeat, oldHeartbeat, now, now);

  // First run: should recover item
  const res1 = runJobRecovery('test_runner_1');
  assert.ok(res1.recovered >= 1, 'First run must recover stuck item');

  // Check state after first run: should be RETRYING or PENDING
  const itemAfter1 = db.prepare(`SELECT technical_status, locked_by FROM job_items WHERE id = ?`).get(itemId);
  assert.strictEqual(itemAfter1.locked_by, null, 'Locked by must be reset to NULL');

  // Second run: should do nothing (idempotent)
  const res2 = runJobRecovery('test_runner_2');
  assert.strictEqual(res2.recovered, 0, 'Second run must recover 0 items (idempotent)');

  // Clean up
  db.prepare(`DELETE FROM job_items WHERE id = ?`).run(itemId);
  db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId);
  db.prepare(`DELETE FROM excel_mappings WHERE id = ?`).run(mId);
  db.prepare(`DELETE FROM excel_files WHERE id = ?`).run(eId);
  db.prepare(`DELETE FROM campaign_rules WHERE id = ?`).run(rId);
  db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(cId);

  console.log('  ✓ Job Recovery Idempotency verified (multiple runs produce same state)');
}
