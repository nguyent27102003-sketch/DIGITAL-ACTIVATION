import assert from 'assert';
import db from '../src/db/index.js';
import crypto from 'crypto';

export async function run() {
  console.log('Running Unit: AI Request Logging Test...');

  const id = `test_ai_${Date.now()}`;
  const promptText = 'Test prompt content for hash verification';
  const responseText = '{"postType": "Video clip"}';
  const inputHash = crypto.createHash('sha256').update(promptText).digest('hex');
  const outputHash = crypto.createHash('sha256').update(responseText).digest('hex');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_requests (
      id, campaign_id, job_id, job_item_id, task_type, purpose, requested_provider, actual_provider,
      requested_model, actual_model, route_name, prompt_version, schema_version,
      input_hash, output_hash, latency_ms, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, 'camp_test', 'job_test', 'item_test', 'CAPTION_ANALYSIS', 'CAPTION_ANALYSIS', '9router', 'gemini',
    'gemini-1.5-flash', 'gemini-1.5-flash', 'fast_vision', 'v2.1', 'v1.0',
    inputHash, outputHash, 450, 'SUCCESS', now
  );

  const row = db.prepare(`SELECT * FROM ai_requests WHERE id = ?`).get(id);
  assert.ok(row, 'AI request record was not created.');
  assert.strictEqual(row.task_type, 'CAPTION_ANALYSIS');
  assert.strictEqual(row.input_hash, inputHash);
  assert.strictEqual(row.output_hash, outputHash);
  assert.strictEqual(row.requested_provider, '9router');

  // Clean up
  db.prepare(`DELETE FROM ai_requests WHERE id = ?`).run(id);

  console.log('  ✓ AI Request Logging verified (Provider tracking & Hashes)');
}
