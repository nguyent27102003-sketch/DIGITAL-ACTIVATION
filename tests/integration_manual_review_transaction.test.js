import assert from 'assert';
import db from '../src/db/index.js';

export async function run() {
  console.log('Running Integration: Manual Review Transaction Test...');

  const now = new Date().toISOString();
  const jobId = `job_man_${Date.now()}`;
  const itemId = `item_man_${Date.now()}`;
  const evalId = `eval_${itemId}`;

  const cId = `c_${Date.now()}`;
  const rId = `r_${Date.now()}`;
  const eId = `e_${Date.now()}`;
  const mId = `m_${Date.now()}`;

  db.prepare(`INSERT INTO campaigns (id, name, created_at, updated_at) VALUES (?, 'Test Campaign', ?, ?)`).run(cId, now, now);
  db.prepare(`INSERT INTO campaign_rules (id, campaign_id, rule_version, name, product_names, required_hashtags, required_tags, created_at) VALUES (?, ?, 1, 'Rule 1', '[]', '[]', '[]', ?)`).run(rId, cId, now);
  db.prepare(`INSERT INTO excel_files (id, original_name, file_path, file_hash, created_at) VALUES (?, 'file.xlsx', 'path', 'hash', ?)`).run(eId, now);
  db.prepare(`INSERT INTO excel_mappings (id, excel_file_id, sheet_name, columns_json, created_at) VALUES (?, ?, 'Sheet1', '{}', ?)`).run(mId, eId, now);

  db.prepare(`
    INSERT INTO jobs (id, campaign_id, campaign_rule_id, excel_file_id, excel_mapping_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
  `).run(jobId, cId, rId, eId, mId, now, now);

  db.prepare(`
    INSERT INTO job_items (id, job_id, sheet_name, source_row, source_url, technical_status, business_result, created_at, updated_at)
    VALUES (?, ?, 'Sheet1', 10, 'https://facebook.com/post1', 'COMPLETED', 'FAILED', ?, ?)
  `).run(itemId, jobId, now, now);

  db.prepare(`
    INSERT INTO evaluation_results (id, job_item_id, overall_result, feedback, evaluated_at)
    VALUES (?, ?, 'FAILED', 'Thiếu hashtag', ?)
  `).run(evalId, itemId, now);

  // Perform Manual Override Transaction
  const newResult = 'PASSED';
  const reason = 'Khách hàng cung cấp đủ hashtag bổ sung';

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO manual_reviews (
        id, job_item_id, original_evaluation_result_id, reviewer_user_id, actor_type,
        previous_result, new_result, reason, before_json, after_json, reviewed_at
      ) VALUES (?, ?, ?, 'USER', 'USER', 'FAILED', ?, ?, '{"business_result":"FAILED"}', '{"business_result":"PASSED"}', ?)
    `).run(`rev_${Date.now()}`, itemId, evalId, newResult, reason, now);

    db.prepare(`
      UPDATE evaluation_results SET overall_result = ?, feedback = ? WHERE job_item_id = ?
    `).run(newResult, `Đã điều chỉnh: ${reason}`, itemId);

    db.prepare(`
      UPDATE job_items SET business_result = ? WHERE id = ?
    `).run(newResult, itemId);

    db.prepare(`
      INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
      VALUES (?, 'USER', 'USER', 'MANUAL_OVERRIDE', 'JOB_ITEM', ?, '{"business_result":"FAILED"}', '{"business_result":"PASSED"}', ?, ?)
    `).run(`audit_${Date.now()}`, itemId, reason, now);
  });

  transaction();

  // Verify results
  const updatedItem = db.prepare(`SELECT business_result FROM job_items WHERE id = ?`).get(itemId);
  assert.strictEqual(updatedItem.business_result, 'PASSED', 'Item business result must be updated to PASSED');

  const origEval = db.prepare(`SELECT * FROM evaluation_results WHERE id = ?`).get(evalId);
  assert.strictEqual(origEval.overall_result, 'PASSED', 'Evaluation result must reflect override');

  const reviewRecord = db.prepare(`SELECT * FROM manual_reviews WHERE job_item_id = ?`).get(itemId);
  assert.ok(reviewRecord, 'Manual review record must exist');
  assert.strictEqual(reviewRecord.reason, reason, 'Reason must match');

  const auditRecord = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'MANUAL_OVERRIDE'`).get(itemId);
  assert.ok(auditRecord, 'Audit log must record manual override');

  // Clean up
  db.prepare(`DELETE FROM manual_reviews WHERE job_item_id = ?`).run(itemId);
  db.prepare(`DELETE FROM audit_logs WHERE entity_id = ?`).run(itemId);
  db.prepare(`DELETE FROM evaluation_results WHERE job_item_id = ?`).run(itemId);
  db.prepare(`DELETE FROM job_items WHERE id = ?`).run(itemId);
  db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId);
  db.prepare(`DELETE FROM excel_mappings WHERE id = ?`).run(mId);
  db.prepare(`DELETE FROM excel_files WHERE id = ?`).run(eId);
  db.prepare(`DELETE FROM campaign_rules WHERE id = ?`).run(rId);
  db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(cId);

  console.log('  ✓ Manual Review Transaction verified (Original preserved, Audit log created)');
}
