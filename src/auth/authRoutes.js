import express from 'express';
import { processGoogleLogin, createSession, revokeSession, revokeAllUserSessions, createAuthAuditLog, SYSTEM_OWNER_EMAIL } from './authService.js';
import { requireAuthentication, requireSuperAdmin } from './authMiddleware.js';
import db from '../db/index.js';

const router = express.Router();

// Helper to set HttpOnly Cookie
function setSessionCookie(res, token) {
  res.cookie('fbeval_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

// Helper to clear Session Cookie
function clearSessionCookie(res) {
  res.clearCookie('fbeval_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

/**
 * GET /api/auth/google
 * Initiates Google OAuth2 authentication flow or simulates for test/dev
 */
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

  // If live credentials present, redirect to Google OAuth
  if (clientId && clientId !== 'mock_google_client_id' && process.env.NODE_ENV === 'production') {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile`;
    return res.redirect(authUrl);
  }

  // Dev / Mock mode prompt or callback
  const mockEmail = req.query.email || 'nq.thien27@gmail.com';
  const mockName = req.query.name || (mockEmail === SYSTEM_OWNER_EMAIL ? 'Nguyễn Quang Thiện' : 'Demo User');
  
  const user = processGoogleLogin({
    googleSubject: `sub_${Buffer.from(mockEmail).toString('hex')}`,
    email: mockEmail,
    displayName: mockName,
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(mockName)}&background=2563eb&color=fff`,
    emailVerified: true
  });

  const { token } = createSession(user.id, req.ip, req.get('User-Agent'));
  setSessionCookie(res, token);

  return res.redirect('/');
});

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth2 redirect callback
 */
router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

  if (!code || clientId === 'mock_google_client_id') {
    return res.redirect('/?auth_error=Missing+Google+OAuth+Code');
  }

  try {
    // 1. Exchange OAuth code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to exchange code with Google');
    }

    // 2. Fetch Google UserInfo
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await userRes.json();

    if (!profile.email || !profile.email_verified) {
      return res.redirect('/?auth_error=Unverified+Google+Email');
    }

    // 3. Process login
    const user = processGoogleLogin({
      googleSubject: profile.sub,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      emailVerified: profile.email_verified
    });

    const { token } = createSession(user.id, req.ip, req.get('User-Agent'));
    setSessionCookie(res, token);

    return res.redirect('/');
  } catch (err) {
    console.error('[Google OAuth Error]:', err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /api/auth/dev-login
 * Development & Testing helper endpoint to trigger Google Sign-In
 */
router.post('/dev-login', (req, res) => {
  const { email, displayName, googleSubject } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const user = processGoogleLogin({
      googleSubject: googleSubject || `sub_${Buffer.from(cleanEmail).toString('hex')}`,
      email: cleanEmail,
      displayName: displayName || cleanEmail.split('@')[0],
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || cleanEmail)}&background=2563eb&color=fff`,
      emailVerified: true
    });

    const { token } = createSession(user.id, req.ip, req.get('User-Agent'));
    setSessionCookie(res, token);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        role: user.role,
        approvalStatus: user.approval_status,
        accountStatus: user.account_status
      }
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', requireAuthentication, (req, res) => {
  if (req.sessionToken) {
    revokeSession(req.sessionToken);
    createAuthAuditLog('USER_LOGOUT', req.user.id, null, 'User logged out');
  }
  clearSessionCookie(res);
  return res.json({ success: true, message: 'Đã đăng xuất thành công.' });
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuthentication, (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
  }

  return res.json({
    success: true,
    user: {
      id: user.id,
      googleSubject: user.google_subject,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      role: user.role,
      approvalStatus: user.approval_status,
      accountStatus: user.account_status,
      approvedBy: user.approved_by,
      approvedAt: user.approved_at,
      rejectionReason: user.rejection_reason,
      suspendedReason: user.suspended_reason,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at
    }
  });
});

// ─────────────────────────────────────────────────────────
// ADMIN USER MANAGEMENT ENDPOINTS (SUPER_ADMIN ONLY)
// ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * Returns list of users filtered by tab status
 */
router.get('/admin/users', requireAuthentication, requireSuperAdmin, (req, res) => {
  const { status } = req.query; // pending, active, rejected, suspended, all
  let query = `SELECT * FROM users`;
  const params = [];

  if (status === 'pending') {
    query += ` WHERE approval_status = 'PENDING' OR account_status = 'PENDING_APPROVAL'`;
  } else if (status === 'active') {
    query += ` WHERE account_status = 'ACTIVE' AND approval_status = 'APPROVED'`;
  } else if (status === 'rejected') {
    query += ` WHERE approval_status = 'REJECTED'`;
  } else if (status === 'suspended') {
    query += ` WHERE account_status = 'SUSPENDED' OR account_status = 'DISABLED'`;
  }

  query += ` ORDER BY created_at DESC`;

  const users = db.prepare(query).all(params);
  return res.json({ success: true, users });
});

/**
 * GET /api/admin/users/pending
 */
router.get('/admin/users/pending', requireAuthentication, requireSuperAdmin, (req, res) => {
  const pendingUsers = db.prepare(`
    SELECT * FROM users WHERE approval_status = 'PENDING' OR account_status = 'PENDING_APPROVAL' ORDER BY created_at DESC
  `).all();
  return res.json({ success: true, users: pendingUsers });
});

/**
 * GET /api/admin/users/:id
 */
router.get('/admin/users/:id', requireAuthentication, requireSuperAdmin, (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const sessions = db.prepare(`SELECT id, ip_address, user_agent, expires_at, revoked_at, created_at FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(user.id);
  return res.json({ success: true, user, sessions });
});

/**
 * POST /api/admin/users/:id/approve
 */
router.post('/admin/users/:id/approve', requireAuthentication, requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const { role = 'OPERATOR' } = req.body;

  if (role === 'SUPER_ADMIN' && targetId !== 'usr_super_admin_owner') {
    return res.status(400).json({ success: false, error: 'Cannot assign SUPER_ADMIN role to other users.' });
  }

  if (!['OPERATOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role. Choose OPERATOR or VIEWER.' });
  }

  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId);
  if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users 
    SET approval_status = 'APPROVED', account_status = 'ACTIVE', role = ?, approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(role, req.user.id, now, now, targetId);

  createAuthAuditLog('USER_APPROVED', targetId, { role, approved_by: req.user.id }, `User approved with role ${role}`);
  createAuthAuditLog('USER_ROLE_CHANGED', targetId, { new_role: role }, `Assigned role ${role}`);

  // Create Notification
  try {
    db.prepare(`
      INSERT INTO notifications (id, type, level, title, message, entity_type, entity_id, dedupe_key, created_at)
      VALUES (?, 'USER_APPROVED', 'SUCCESS', 'Tài khoản đã được phê duyệt', ?, 'USER', ?, ?, ?)
    `).run(
      `ntf_appr_${Date.now()}`,
      `Tài khoản ${targetUser.email} đã được phê duyệt với vai trò ${role}.`,
      targetId,
      `appr_${targetId}_${Date.now()}`,
      now
    );
  } catch (_) {}

  return res.json({ success: true, message: `Đã phê duyệt người dùng ${targetUser.email} thành công với quyền ${role}.` });
});

/**
 * POST /api/admin/users/:id/reject
 */
router.post('/admin/users/:id/reject', requireAuthentication, requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, error: 'Bắt buộc nhập lý do từ chối.' });
  }

  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId);
  if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

  if (targetUser.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL) {
    return res.status(403).json({ success: false, error: 'Không thể từ chối tài khoản Owner hệ thống.' });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users 
    SET approval_status = 'REJECTED', account_status = 'DISABLED', rejection_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(reason.trim(), now, targetId);

  revokeAllUserSessions(targetId);
  createAuthAuditLog('USER_REJECTED', targetId, { reason }, `User rejected: ${reason}`);

  return res.json({ success: true, message: `Đã từ chối tài khoản ${targetUser.email}.` });
});

/**
 * POST /api/admin/users/:id/suspend
 */
router.post('/admin/users/:id/suspend', requireAuthentication, requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, error: 'Bắt buộc nhập lý do tạm khóa.' });
  }

  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId);
  if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

  if (targetUser.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL) {
    return res.status(403).json({ success: false, error: 'Không thể khóa tài khoản Owner hệ thống.' });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users 
    SET account_status = 'SUSPENDED', suspended_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(reason.trim(), now, targetId);

  revokeAllUserSessions(targetId);
  createAuthAuditLog('USER_SUSPENDED', targetId, { reason }, `User suspended: ${reason}`);
  createAuthAuditLog('USER_ACCESS_REVOKED', targetId, { reason }, `All sessions revoked for user ${targetUser.email}`);

  return res.json({ success: true, message: `Đã tạm khóa tài khoản ${targetUser.email}.` });
});

/**
 * POST /api/admin/users/:id/reactivate
 */
router.post('/admin/users/:id/reactivate', requireAuthentication, requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId);
  if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users 
    SET account_status = 'ACTIVE', approval_status = 'APPROVED', updated_at = ?
    WHERE id = ?
  `).run(now, targetId);

  createAuthAuditLog('USER_REACTIVATED', targetId, null, 'User account reactivated');
  return res.json({ success: true, message: `Đã mở khóa tài khoản ${targetUser.email}.` });
});

/**
 * POST /api/admin/users/:id/revoke
 */
router.post('/admin/users/:id/revoke', requireAuthentication, requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, error: 'Bắt buộc nhập lý do thu hồi quyền.' });
  }

  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId);
  if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

  if (targetUser.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL) {
    return res.status(403).json({ success: false, error: 'Không thể thu hồi quyền tài khoản Owner hệ thống.' });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users 
    SET approval_status = 'REVOKED', account_status = 'DISABLED', rejection_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(reason.trim(), now, targetId);

  revokeAllUserSessions(targetId);
  createAuthAuditLog('USER_ACCESS_REVOKED', targetId, { reason }, `User access revoked: ${reason}`);

  return res.json({ success: true, message: `Đã thu hồi quyền truy cập của ${targetUser.email}.` });
});

/**
 * PATCH /api/admin/users/:id/role
 */
router.patch('/admin/users/:id/role', requireAuthentication, requireSuperAdmin, (req, res) => {
  const targetId = req.params.id;
  const { role } = req.body;

  if (!['OPERATOR', 'VIEWER'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role. Choose OPERATOR or VIEWER.' });
  }

  const targetUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetId);
  if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

  if (targetUser.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL) {
    return res.status(403).json({ success: false, error: 'Không thể thay đổi quyền của Owner hệ thống.' });
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).run(role, now, targetId);

  createAuthAuditLog('USER_ROLE_CHANGED', targetId, { old_role: targetUser.role, new_role: role }, `Role changed to ${role}`);
  return res.json({ success: true, message: `Đã cập nhật vai trò của ${targetUser.email} thành ${role}.` });
});

export default router;
