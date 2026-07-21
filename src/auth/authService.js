import crypto from 'crypto';
import db from '../db/index.js';

export const SYSTEM_OWNER_EMAIL = (process.env.SYSTEM_OWNER_EMAIL || 'nq.thien27@gmail.com').trim().toLowerCase();

/**
 * Normalizes email address
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Creates or updates user upon Google authentication
 */
export function processGoogleLogin({ googleSubject, email, displayName, avatarUrl, emailVerified = true }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) {
    throw new Error('Email address is required');
  }
  if (!emailVerified) {
    throw new Error('Google email is not verified');
  }

  const isOwner = cleanEmail === SYSTEM_OWNER_EMAIL;
  const now = new Date().toISOString();

  let user = db.prepare(`SELECT * FROM users WHERE email = ? OR google_subject = ?`).get(cleanEmail, googleSubject);

  if (!user) {
    const userId = isOwner ? 'usr_super_admin_owner' : `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const role = isOwner ? 'SUPER_ADMIN' : 'VIEWER';
    const approvalStatus = isOwner ? 'APPROVED' : 'PENDING';
    const accountStatus = isOwner ? 'ACTIVE' : 'PENDING_APPROVAL';

    db.prepare(`
      INSERT INTO users (
        id, google_subject, email, display_name, avatar_url,
        role, approval_status, account_status, created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      googleSubject,
      cleanEmail,
      displayName || cleanEmail.split('@')[0],
      avatarUrl || 'https://lh3.googleusercontent.com/a/default-user',
      role,
      approvalStatus,
      accountStatus,
      now,
      now,
      now
    );

    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

    // Create Audit Log
    createAuthAuditLog('USER_REGISTERED', userId, { email: cleanEmail, role, approvalStatus }, 'User registered via Google Sign-In');

    // Create Notification for Super Admin if not owner
    if (!isOwner) {
      try {
        db.prepare(`
          INSERT INTO notifications (id, type, level, title, message, entity_type, entity_id, dedupe_key, created_at)
          VALUES (?, 'USER_REGISTRATION', 'INFO', 'Yêu cầu sử dụng mới', ?, 'USER', ?, ?, ?)
        `).run(
          `ntf_reg_${userId}`,
          `Người dùng ${displayName || cleanEmail} (${cleanEmail}) đang yêu cầu quyền sử dụng FBEval.`,
          userId,
          `reg_${userId}`,
          now
        );
      } catch (_) {}
    }
  } else {
    // Existing user: check if owner, ensure owner is never demoted
    if (isOwner && (user.role !== 'SUPER_ADMIN' || user.approval_status !== 'APPROVED' || user.account_status !== 'ACTIVE')) {
      db.prepare(`
        UPDATE users 
        SET role = 'SUPER_ADMIN', approval_status = 'APPROVED', account_status = 'ACTIVE', updated_at = ?
        WHERE id = ?
      `).run(now, user.id);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    }

    // Update last login & profile info
    db.prepare(`
      UPDATE users 
      SET display_name = ?, avatar_url = ?, last_login_at = ?, updated_at = ?
      WHERE id = ?
    `).run(displayName || user.display_name, avatarUrl || user.avatar_url, now, now, user.id);

    createAuthAuditLog('USER_LOGIN', user.id, { email: cleanEmail }, 'User logged in via Google');
  }

  return user;
}

/**
 * Creates a secure session for user
 */
export function createSession(userId, ipAddress = '127.0.0.1', userAgent = 'Unknown') {
  const sessionId = `sess_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const token = crypto.randomBytes(32).toString('hex');
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.prepare(`
    INSERT INTO user_sessions (id, user_id, session_hash, ip_address, user_agent, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, sessionHash, ipAddress, userAgent, expiresAt, now.toISOString());

  return { sessionId, token, expiresAt };
}

/**
 * Validates a session token
 */
export function validateSessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`
    SELECT s.*, u.id as user_id, u.email, u.display_name, u.avatar_url, u.role, u.approval_status, u.account_status
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_hash = ? AND s.revoked_at IS NULL
  `).get(sessionHash);

  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    return null; // Expired
  }

  return session;
}

/**
 * Revokes all sessions for a user
 */
export function revokeAllUserSessions(userId) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(now, userId);
}

/**
 * Revokes a specific session
 */
export function revokeSession(token) {
  if (!token) return;
  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE session_hash = ?`).run(new Date().toISOString(), sessionHash);
}

/**
 * Helper to write audit logs for Auth actions
 */
export function createAuthAuditLog(action, entityId, afterJson = null, reason = '') {
  try {
    const id = `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, after_json, reason, created_at)
      VALUES (?, 'SYSTEM', 'AUTH', ?, 'USER', ?, ?, ?, ?)
    `).run(id, action, entityId, JSON.stringify(afterJson), reason, new Date().toISOString());
  } catch (err) {
    console.error('[Audit Log] Failed to log:', err.message);
  }
}
