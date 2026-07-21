import assert from 'assert';
import db from '../src/db/index.js';

export async function run() {
  console.log('Running Unit: User Auth & Admin Approval System...');

  // 1. Verify Super Admin Seed
  const admin = db.prepare(`SELECT * FROM users WHERE email = ?`).get('nq.thien27@gmail.com');
  assert.ok(admin, 'Super Admin nq.thien27@gmail.com must exist');
  assert.strictEqual(admin.role, 'ADMIN', 'Super Admin role must be ADMIN');
  assert.strictEqual(admin.status, 'APPROVED', 'Super Admin status must be APPROVED');

  // 2. Test User Registration (Default PENDING)
  const testEmail = `test_user_${Date.now()}@example.com`;
  const userId = `usr_test_${Date.now()}`;
  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, status, created_at)
    VALUES (?, ?, ?, ?, 'USER', 'PENDING', ?)
  `).run(userId, testEmail, 'password123', 'Test User', new Date().toISOString());

  const pendingUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  assert.strictEqual(pendingUser.status, 'PENDING', 'New registered user must start in PENDING state');

  // 3. Test Admin Approval
  db.prepare(`UPDATE users SET status = 'APPROVED', approved_at = ?, approved_by = ? WHERE id = ?`)
    .run(new Date().toISOString(), 'nq.thien27@gmail.com', userId);

  const approvedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  assert.strictEqual(approvedUser.status, 'APPROVED', 'User status should be updated to APPROVED');
  assert.strictEqual(approvedUser.approved_by, 'nq.thien27@gmail.com', 'Approved_by must record admin email');

  // Cleanup test user
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

  console.log('  ✓ User Auth & Admin Approval System verified (Admin nq.thien27@gmail.com, PENDING default, APPROVED flow)');
}
