/**
 * Access State Detector V2.1
 * Classifies the access state of a post/URL into standardized categories.
 *
 * Official Access State Names (per spec V2.1 revision 2):
 *   1. ACCESSIBLE
 *   2. LOGIN_REQUIRED
 *   3. SESSION_EXPIRED
 *   4. PRIVATE_POST
 *   5. POST_DELETED
 *   6. CAPTCHA
 *   7. CHECKPOINT
 *   8. RATE_LIMITED
 *   9. NAVIGATION_TIMEOUT
 *  10. NETWORK_ERROR
 *  11. UNSUPPORTED_URL
 *  12. UNKNOWN_ACCESS_ERROR
 */

const FB_LOGIN_SIGNALS = [
  'id=login_popup_cta_btn',
  'id=email',
  'name=email',
  '/login/?next=',
  'Đăng nhập vào Facebook',
  'Log in to Facebook',
  'You must log in',
  'Đăng nhập hoặc tạo tài khoản',
];

const FB_CHECKPOINT_SIGNALS = [
  '/checkpoint/',
  'id=checkpointSubmitButton',
  'xác nhận danh tính',
  'confirm your identity',
  'Bảo vệ tài khoản',
  'secure your account',
];

const FB_CAPTCHA_SIGNALS = [
  'id=captcha',
  'recaptcha',
  'Vui lòng hoàn thành xác minh',
  'please complete the verification',
  'captcha',
  'challenge',
];

const FB_DELETED_SIGNALS = [
  'Nội dung này hiện không khả dụng',
  'This content isn\'t available',
  'This content is no longer available',
  'Trang này hiện không khả dụng',
  'Link you followed may be broken',
  'nội dung không tồn tại',
  'Sorry, this content isn\'t available',
  'Nội dung bạn đang tìm kiếm không khả dụng',
];

const FB_PRIVATE_SIGNALS = [
  'Chỉ bạn bè mới xem được',
  'Only friends can see',
  'bài viết này ở chế độ riêng tư',
  'This post is private',
  'Nhóm kín',
  'Private group',
];

const FB_RATE_LIMIT_SIGNALS = [
  'Tạm thời bị chặn',
  'You\'re temporarily blocked',
  'Bạn đã đăng quá nhiều',
  'you\'ve been blocked',
  'Hành động bị chặn',
  'Action Blocked',
];

/**
 * Detect official access state from page content, URL, title and HTTP status code.
 * 
 * @param {string} currentUrl
 * @param {string} pageTitle
 * @param {string} bodyText
 * @param {number} [statusCode]
 * @returns {'ACCESSIBLE'|'LOGIN_REQUIRED'|'SESSION_EXPIRED'|'PRIVATE_POST'|'POST_DELETED'|'CAPTCHA'|'CHECKPOINT'|'RATE_LIMITED'|'NAVIGATION_TIMEOUT'|'NETWORK_ERROR'|'UNSUPPORTED_URL'|'UNKNOWN_ACCESS_ERROR'}
 */
export function detectAccessState(currentUrl, pageTitle, bodyText, statusCode) {
  const url = (currentUrl || '').toLowerCase();
  const title = (pageTitle || '').toLowerCase();
  const body = (bodyText || '').toLowerCase();

  if (!url) return 'UNSUPPORTED_URL';

  // Check URL scheme / domain (allow 127.0.0.1/localhost for local integration tests)
  if (!url.includes('facebook.com') && !url.includes('fb.watch') && !url.includes('fb.com') && !url.includes('tiktok.com') && !url.includes('127.0.0.1') && !url.includes('localhost')) {
    return 'UNSUPPORTED_URL';
  }

  // 1. Checkpoint / Session expired
  if (FB_CHECKPOINT_SIGNALS.some(s => url.includes(s.toLowerCase()) || body.includes(s.toLowerCase()))) {
    return 'CHECKPOINT';
  }

  // 2. CAPTCHA
  if (FB_CAPTCHA_SIGNALS.some(s => url.includes(s.toLowerCase()) || body.includes(s.toLowerCase()))) {
    return 'CAPTCHA';
  }

  // 3. Login wall / session expired
  if (
    url.includes('/login') ||
    url.includes('/signin') ||
    FB_LOGIN_SIGNALS.some(s => body.includes(s.toLowerCase()) || url.includes(s.toLowerCase()))
  ) {
    return 'LOGIN_REQUIRED';
  }

  // 4. Rate limited / blocked
  if (FB_RATE_LIMIT_SIGNALS.some(s => body.includes(s.toLowerCase()))) {
    return 'RATE_LIMITED';
  }

  // 5. Deleted / unavailable
  if (statusCode === 404 || FB_DELETED_SIGNALS.some(s => body.includes(s.toLowerCase()))) {
    return 'POST_DELETED';
  }

  // 6. Private post
  if (FB_PRIVATE_SIGNALS.some(s => body.includes(s.toLowerCase()))) {
    return 'PRIVATE_POST';
  }

  // 7. Accessible
  return 'ACCESSIBLE';
}

/**
 * Map official Access State to technical_status, business_result and job action.
 * 
 * Official Mapping Table (Spec V2.1 Revision 2):
 * | Access State           | technical_status   | business_result | Action           |
 * | ACCESSIBLE           | PROCESSING         | NULL            | Continue         |
 * | LOGIN_REQUIRED       | PROCESSING_ERROR   | NULL            | Pause Job        |
 * | SESSION_EXPIRED      | PROCESSING_ERROR   | NULL            | Pause Job        |
 * | PRIVATE_POST         | COMPLETED          | INACCESSIBLE    | No retry         |
 * | POST_DELETED         | COMPLETED          | INACCESSIBLE    | No retry         |
 * | CAPTCHA              | PROCESSING_ERROR   | NULL            | Pause Job        |
 * | CHECKPOINT           | PROCESSING_ERROR   | NULL            | Pause Job        |
 * | RATE_LIMITED         | RETRYING           | NULL            | Backoff          |
 * | NAVIGATION_TIMEOUT   | RETRYING           | NULL            | Backoff          |
 * | NETWORK_ERROR        | RETRYING           | NULL            | Backoff          |
 * | UNSUPPORTED_URL      | COMPLETED          | INACCESSIBLE    | No retry         |
 * | UNKNOWN_ACCESS_ERROR | PROCESSING_ERROR   | NULL            | Log error        |
 * 
 * @param {string} accessState
 * @param {number} [attemptCount=1]
 * @param {number} [maxAttempts=4]
 * @returns {{ technicalStatus: string, businessResult: string|null, shouldPauseJob: boolean, isRetryable: boolean }}
 */
export function mapAccessStateToItemStatus(accessState, attemptCount = 1, maxAttempts = 4) {
  switch (accessState) {
    case 'ACCESSIBLE':
      return { technicalStatus: 'PROCESSING', businessResult: null, shouldPauseJob: false, isRetryable: false };

    case 'LOGIN_REQUIRED':
    case 'SESSION_EXPIRED':
    case 'CAPTCHA':
    case 'CHECKPOINT':
      return { technicalStatus: 'PROCESSING_ERROR', businessResult: null, shouldPauseJob: true, isRetryable: false };

    case 'PRIVATE': // fallback alias
    case 'PRIVATE_POST':
    case 'DELETED': // fallback alias
    case 'POST_DELETED':
    case 'UNSUPPORTED_URL':
      return { technicalStatus: 'COMPLETED', businessResult: 'INACCESSIBLE', shouldPauseJob: false, isRetryable: false };

    case 'RATE_LIMITED':
    case 'NAVIGATION_TIMEOUT':
    case 'NETWORK_ERROR':
      if (attemptCount < maxAttempts) {
        return { technicalStatus: 'RETRYING', businessResult: null, shouldPauseJob: false, isRetryable: true };
      }
      return { technicalStatus: 'PROCESSING_ERROR', businessResult: null, shouldPauseJob: false, isRetryable: false };

    case 'UNKNOWN_ACCESS_ERROR':
    default:
      return { technicalStatus: 'PROCESSING_ERROR', businessResult: null, shouldPauseJob: false, isRetryable: false };
  }
}

export function mapAccessStateToBusinessResult(accessState) {
  const status = mapAccessStateToItemStatus(accessState);
  return {
    businessResult: status.businessResult || (status.technicalStatus === 'PROCESSING_ERROR' ? 'PROCESSING_ERROR' : null),
    shouldPauseJob: status.shouldPauseJob
  };
}



