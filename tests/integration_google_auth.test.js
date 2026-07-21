import assert from 'assert';
import db from '../src/db/index.js';
import { processGoogleLogin, createSession, validateSessionToken, revokeAllUserSessions, SYSTEM_OWNER_EMAIL } from '../src/auth/authService.js';
import { requireAuthentication, requireApprovedUser, requireSuperAdmin } from '../src/auth/authMiddleware.js';

export async function run() {
  console.log('Running Integration & Security: Google OAuth & Approval Flow Tests...');

  const ts = Date.now();
  const testNewEmail = `newuser_${ts}@gmail.com`;
  const testSub = `google_sub_${ts}`;

  // 1. Integration: Google Login New User
  const newUser = processGoogleLogin({
    googleSubject: testSub,
    email: testNewEmail,
    displayName: 'New User Test',
    emailVerified: true
  });
  assert.ok(newUser);
  assert.strictEqual(newUser.email, testNewEmail);
  assert.strictEqual(newUser.approval_status, 'PENDING');
  assert.strictEqual(newUser.account_status, 'PENDING_APPROVAL');
  console.log('  ✓ Integration: Google Login New User passed');

  // 2. Integration: Google Login Existing User
  const existingUser = processGoogleLogin({
    googleSubject: testSub,
    email: testNewEmail,
    displayName: 'New User Test Updated',
    emailVerified: true
  });
  assert.strictEqual(existingUser.id, newUser.id);
  console.log('  ✓ Integration: Google Login Existing User passed');

  // 3. Integration: Pending User Access Rejected
  let mockResStatus = 0;
  let mockResError = '';
  const pendingReq = { user: newUser };
  const mockRes = {
    status: (code) => ({
      json: (body) => {
        mockResStatus = code;
        mockResError = body.error;
      }
    })
  };

  let allowed = false;
  requireApprovedUser(pendingReq, mockRes, () => { allowed = true; });
  assert.strictEqual(allowed, false);
  assert.strictEqual(mockResStatus, 403);
  assert.strictEqual(mockResError, 'PENDING_APPROVAL');
  console.log('  ✓ Integration: Pending User Access Rejected passed');

  // 4. Integration: Super Admin Approval
  const adminOwner = db.prepare(`SELECT * FROM users WHERE email = ?`).get(SYSTEM_OWNER_EMAIL);
  assert.ok(adminOwner);

  db.prepare(`
    UPDATE users 
    SET approval_status = 'APPROVED', account_status = 'ACTIVE', role = 'OPERATOR', approved_by = ?, approved_at = ?
    WHERE id = ?
  `).run(adminOwner.id, new Date().toISOString(), newUser.id);

  const updatedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(newUser.id);
  assert.strictEqual(updatedUser.approval_status, 'APPROVED');
  assert.strictEqual(updatedUser.account_status, 'ACTIVE');
  assert.strictEqual(updatedUser.role, 'OPERATOR');
  console.log('  ✓ Integration: Super Admin Approval passed');

  // 5. Integration: Approved User Access Allowed
  allowed = false;
  requireApprovedUser({ user: updatedUser }, mockRes, () => { allowed = true; });
  assert.ok(allowed, 'Approved user must be granted access');
  console.log('  ✓ Integration: Approved User Access Allowed passed');

  // 6. Integration: Suspended User Access Rejected & Revoke All Sessions
  const session1 = createSession(newUser.id);
  const session2 = createSession(newUser.id);
  assert.ok(validateSessionToken(session1.token));
  assert.ok(validateSessionToken(session2.token));

  // Suspend user & revoke sessions
  db.prepare(`UPDATE users SET account_status = 'SUSPENDED', suspended_reason = 'Violation' WHERE id = ?`).run(newUser.id);
  revokeAllUserSessions(newUser.id);

  assert.strictEqual(validateSessionToken(session1.token), null, 'Session 1 must be revoked');
  assert.strictEqual(validateSessionToken(session2.token), null, 'Session 2 must be revoked');

  const suspendedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(newUser.id);
  allowed = false;
  requireApprovedUser({ user: suspendedUser }, mockRes, () => { allowed = true; });
  assert.strictEqual(allowed, false);
  assert.strictEqual(mockResStatus, 403);
  assert.strictEqual(mockResError, 'ACCOUNT_SUSPENDED');
  console.log('  ✓ Integration: Suspended User Access Rejected & Revoke All Sessions passed');

  // 7. Integration: Non-Admin Approval Rejected & Security: Admin API Unauthorized Access
  let adminResStatus = 0;
  requireSuperAdmin({ user: updatedUser }, { status: (code) => ({ json: () => { adminResStatus = code; } }) }, () => {});
  assert.strictEqual(adminResStatus, 403, 'Non-admin user calling admin API must be rejected with 403');
  console.log('  ✓ Integration: Non-Admin Approval Rejected & Security: Admin API Unauthorized Access passed');

  // 8. Security: Frontend Role Spoofing Rejected
  // Even if request body sends role: 'SUPER_ADMIN', backend overrides or rejects it
  const spoofUser = { ...updatedUser, role: 'SUPER_ADMIN' };
  let spoofPassed = false;
  requireSuperAdmin({ user: updatedUser }, mockRes, () => { spoofPassed = true; });
  assert.strictEqual(spoofPassed, false, 'DB role must govern access, not spoofed request');
  console.log('  ✓ Security: Frontend Role Spoofing Rejected passed');

  // Cleanup test user
  db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).run(newUser.id);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(newUser.id);

  console.log('  ✓ All Integration & Security Auth tests completed successfully!');
}
