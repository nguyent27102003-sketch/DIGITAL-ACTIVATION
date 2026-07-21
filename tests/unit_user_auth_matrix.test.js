import assert from 'assert';
import db, { ensureOwnerUser } from '../src/db/index.js';
import { normalizeEmail, processGoogleLogin, SYSTEM_OWNER_EMAIL } from '../src/auth/authService.js';
import { requireRole } from '../src/auth/authMiddleware.js';

export async function run() {
  console.log('Running Unit: User Auth & Approval Matrix Tests...');

  // 1. Unit: Owner Email Normalization
  assert.strictEqual(normalizeEmail('  NQ.THIEN27@GMAIL.COM  '), 'nq.thien27@gmail.com');
  assert.strictEqual(normalizeEmail('User.Test@Example.COM'), 'user.test@example.com');
  assert.strictEqual(normalizeEmail(''), '');
  console.log('  ✓ Unit: Owner Email Normalization passed');

  // 2. Unit: Owner Auto-Provisioning
  ensureOwnerUser();
  const owner = db.prepare(`SELECT * FROM users WHERE email = ?`).get(SYSTEM_OWNER_EMAIL);
  assert.ok(owner, 'Owner user must exist');
  assert.strictEqual(owner.role, 'SUPER_ADMIN', 'Owner role must be SUPER_ADMIN');
  assert.strictEqual(owner.approval_status, 'APPROVED', 'Owner approval_status must be APPROVED');
  assert.strictEqual(owner.account_status, 'ACTIVE', 'Owner account_status must be ACTIVE');
  console.log('  ✓ Unit: Owner Auto-Provisioning passed');

  // 3. Unit: Role Permission Matrix
  const reqSuperAdmin = requireRole(['SUPER_ADMIN']);
  const reqOperator = requireRole(['OPERATOR']);
  
  let mockRes = { status: (code) => ({ json: (d) => ({ code, d }) }) };
  let passed = false;

  // SUPER_ADMIN passes OPERATOR check
  reqOperator({ user: { role: 'SUPER_ADMIN', email: SYSTEM_OWNER_EMAIL } }, mockRes, () => { passed = true; });
  assert.ok(passed, 'SUPER_ADMIN should pass OPERATOR check');

  // OPERATOR fails SUPER_ADMIN check
  passed = false;
  let resStatus = 0;
  reqSuperAdmin(
    { user: { role: 'OPERATOR', email: 'op@example.com' } },
    { status: (code) => ({ json: () => { resStatus = code; } }) },
    () => { passed = true; }
  );
  assert.strictEqual(passed, false);
  assert.strictEqual(resStatus, 403, 'OPERATOR must be rejected from SUPER_ADMIN route with 403');
  console.log('  ✓ Unit: Role Permission Matrix passed');

  // 4. Unit: Approval Status Validation
  const pendingUser = processGoogleLogin({
    googleSubject: `sub_unit_test_${Date.now()}`,
    email: `unit_new_${Date.now()}@example.com`,
    displayName: 'Unit New User',
    emailVerified: true
  });
  assert.strictEqual(pendingUser.role, 'VIEWER');
  assert.strictEqual(pendingUser.approval_status, 'PENDING');
  assert.strictEqual(pendingUser.account_status, 'PENDING_APPROVAL');

  // Cleanup test user
  db.prepare(`DELETE FROM users WHERE id = ?`).run(pendingUser.id);
  console.log('  ✓ Unit: Approval Status Validation passed');
}
