import { validateSessionToken, SYSTEM_OWNER_EMAIL } from './authService.js';
import db from '../db/index.js';

/**
 * 1. requireAuthentication
 * Verifies valid session token from HttpOnly cookie or Authorization header.
 */
export function requireAuthentication(req, res, next) {
  let token = null;

  // Read from cookie
  if (req.cookies && req.cookies.fbeval_session) {
    token = req.cookies.fbeval_session;
  }
  // Read from Authorization header
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHENTICATED',
      message: 'Vui lòng đăng nhập qua Google để tiếp tục.'
    });
  }

  const session = validateSessionToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_SESSION',
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.'
    });
  }

  // Fetch full user record
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(session.user_id);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'USER_NOT_FOUND',
      message: 'Tài khoản không tồn tại trên hệ thống.'
    });
  }

  req.user = user;
  req.sessionInfo = session;
  req.sessionToken = token;
  next();
}

/**
 * 2. requireApprovedUser
 * Checks if user is ACTIVE and APPROVED.
 */
export function requireApprovedUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHENTICATED',
      message: 'Vui lòng đăng nhập qua Google.'
    });
  }

  if (req.user.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL) {
    return next(); // Owner bypasses approval checks
  }

  if (req.user.approval_status === 'PENDING' || req.user.account_status === 'PENDING_APPROVAL') {
    return res.status(403).json({
      success: false,
      error: 'PENDING_APPROVAL',
      message: 'Yêu cầu sử dụng FBEval đã được gửi. Tài khoản của bạn đang chờ quản trị viên phê duyệt.'
    });
  }

  if (req.user.approval_status === 'REJECTED' || req.user.account_status === 'DISABLED') {
    return res.status(403).json({
      success: false,
      error: 'LOGIN_REJECTED_DISABLED',
      message: `Tài khoản của bạn đã bị từ chối hoặc bị khóa. Lý do: ${req.user.rejection_reason || req.user.suspended_reason || 'Chưa cung cấp lý do'}`
    });
  }

  if (req.user.account_status === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      error: 'ACCOUNT_SUSPENDED',
      message: `Tài khoản của bạn đang tạm khóa. Lý do: ${req.user.suspended_reason || 'Vui lòng liên hệ Admin'}`
    });
  }

  if (req.user.approval_status === 'REVOKED') {
    return res.status(403).json({
      success: false,
      error: 'ACCESS_REVOKED',
      message: 'Quyền truy cập của bạn đã bị thu hồi.'
    });
  }

  if (req.user.approval_status !== 'APPROVED' || req.user.account_status !== 'ACTIVE') {
    return res.status(403).json({
      success: false,
      error: 'NOT_APPROVED',
      message: 'Tài khoản chưa được kích hoạt.'
    });
  }

  next();
}

/**
 * 3. requireRole(roles)
 * Enforces role-based permissions (SUPER_ADMIN, OPERATOR, VIEWER).
 */
export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
    }

    if (req.user.role === 'SUPER_ADMIN' || req.user.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL) {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `Vai trò ${req.user.role} không có quyền thực hiện thao tác này. Yêu cầu: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

/**
 * 4. requireSuperAdmin
 * Restricts access exclusively to SUPER_ADMIN (nq.thien27@gmail.com).
 */
export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
  }

  const isOwner = req.user.email.trim().toLowerCase() === SYSTEM_OWNER_EMAIL;
  if (req.user.role !== 'SUPER_ADMIN' && !isOwner) {
    return res.status(403).json({
      success: false,
      error: 'SUPER_ADMIN_REQUIRED',
      message: 'Chỉ Super Admin mới có quyền truy cập tính năng quản trị này.'
    });
  }

  next();
}
