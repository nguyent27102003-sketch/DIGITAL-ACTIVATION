/**
 * Evaluation Decision Engine — Deterministic Business Logic
 * 
 * CRITICAL SPEC RULES (§13):
 *  - Decision is NEVER delegated solely to AI.
 *  - AI may inform ĐK2 analysis (semantic CTA, product match), but cannot override rules.
 *  - If data is missing: technicalStatus = NEEDS_REVIEW, businessResult = null (NOT "FAILED").
 *  - INACCESSIBLE and PROCESSING_ERROR are distinct from FAILED.
 *  - `item.dk1 ? item.dk1.isStandard : true` pattern is FORBIDDEN.
 *  - All results must be computed from code — never default `true` when data is absent.
 */

/**
 * Normalizes Vietnamese text for robust matching (removes diacritics).
 */
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s#@_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Evaluates ĐK1 — Duration requirement.
 * 
 * Strictly per spec §13.1:
 *  - If duration is missing OR post type is unknown → NEEDS_REVIEW (NOT FAILED)
 *  - Only returns PASSED or FAILED when duration is concretely known
 * 
 * @param {object} scrapeData
 * @param {object} rule
 * @returns {{ passed: boolean|null, status: 'PASSED'|'FAILED'|'NEEDS_REVIEW', reason: string, durationSec: number|null, postType: string }}
 */
export function evaluateDk1(scrapeData, rule) {
  const postType = (scrapeData && scrapeData.postType) || null;
  const durationSec = (scrapeData && scrapeData.durationSeconds !== undefined) ? scrapeData.durationSeconds : null;

  // Missing or unknown post type — cannot determine rule to apply
  if (!postType || postType === 'Unknown') {
    return {
      passed: null,
      status: 'NEEDS_REVIEW',
      reason: 'Không xác định được loại bài (Livestream hay Video clip). Cần kiểm tra thủ công.',
      durationSec,
      postType: postType || 'Unknown'
    };
  }

  // Duration not extracted — cannot evaluate
  if (durationSec === null || durationSec === undefined) {
    return {
      passed: null,
      status: 'NEEDS_REVIEW',
      reason: `Không đọc được thời lượng ${postType}. Cần kiểm tra thủ công.`,
      durationSec: null,
      postType
    };
  }

  const minVideo = (rule && rule.minVideoDurationSec) ? Number(rule.minVideoDurationSec) : 30;
  const minLive = (rule && rule.minLivestreamDurationSec) ? Number(rule.minLivestreamDurationSec) : 900;

  if (postType === 'Livestream') {
    const passed = durationSec >= minLive;
    const minMinutes = Math.floor(minLive / 60);
    const actualMinutes = Math.floor(durationSec / 60);
    return {
      passed,
      status: passed ? 'PASSED' : 'FAILED',
      reason: passed
        ? `Thời lượng livestream ${actualMinutes} phút ${durationSec % 60}s ≥ ${minMinutes} phút yêu cầu.`
        : `Thời lượng livestream ${actualMinutes} phút ${durationSec % 60}s < ${minMinutes} phút yêu cầu.`,
      durationSec,
      postType
    };
  }

  // Video clip (default)
  const passed = durationSec >= minVideo;
  return {
    passed,
    status: passed ? 'PASSED' : 'FAILED',
    reason: passed
      ? `Thời lượng video ${durationSec}s ≥ ${minVideo}s yêu cầu.`
      : `Thời lượng video ${durationSec}s < ${minVideo}s yêu cầu.`,
    durationSec,
    postType
  };
}

/**
 * Evaluates ĐK2 — Caption, Hashtag, Tag, Product, CTA.
 * 
 * Strictly per spec §13.2:
 *  - ĐK2 only PASSES when ALL required conditions are met.
 *  - Missing caption → NEEDS_REVIEW (not FAILED — we don't know if it exists or not).
 *  - AI may provide semantic input (hasCTA, productMatched) but does NOT override rule.
 *  - Each missing element must be explicitly named in the reason.
 * 
 * @param {object} scrapeData
 * @param {object} rule
 * @param {object|null} aiAnalysis - AI semantic analysis (optional, not authoritative)
 * @returns {{ passed: boolean|null, status: 'PASSED'|'FAILED'|'NEEDS_REVIEW', detail: object, reason: string }}
 */
export function evaluateDk2(scrapeData, rule, aiAnalysis = null) {
  const caption = (scrapeData && scrapeData.captionText) ? scrapeData.captionText : null;

  // No caption available — cannot evaluate ĐK2
  if (!caption) {
    return {
      passed: null,
      status: 'NEEDS_REVIEW',
      detail: {
        matchedHashtags: [],
        missingHashtags: (rule && rule.requiredHashtags) || [],
        matchedTags: [],
        missingTags: (rule && rule.requiredTags) || [],
        productMatched: null,
        ctaPassed: null
      },
      reason: 'Không thu thập được nội dung caption để đối chiếu ĐK2. Cần kiểm tra thủ công.'
    };
  }

  const normCaption = normalizeText(caption);

  // 1. Hashtags — exact + normalized match
  const requiredHashtags = (rule && rule.requiredHashtags) ? rule.requiredHashtags : [];
  const matchedHashtags = [];
  const missingHashtags = [];

  for (const tag of requiredHashtags) {
    const normTag = normalizeText(tag);
    if (normCaption.includes(normTag)) {
      matchedHashtags.push(tag);
    } else {
      missingHashtags.push(tag);
    }
  }

  // 2. Fanpage / Page Tags — exact + normalized match
  const requiredTags = (rule && rule.requiredTags) ? rule.requiredTags : [];
  const matchedTags = [];
  const missingTags = [];

  for (const tagObj of requiredTags) {
    const tagText = typeof tagObj === 'string' ? tagObj : (tagObj.displayName || tagObj.name || '');
    const normTag = normalizeText(tagText);
    if (normTag && normCaption.includes(normTag)) {
      matchedTags.push(tagText);
    } else if (tagText) {
      missingTags.push(tagText);
    }
  }

  // 3. Product Names — at least one must appear in caption
  const productNames = (rule && rule.productNames) ? rule.productNames : [];
  let productMatched = productNames.length === 0; // no requirement = auto-pass

  if (!productMatched) {
    for (const prod of productNames) {
      if (prod && normCaption.includes(normalizeText(prod))) {
        productMatched = true;
        break;
      }
    }
  }

  // 4. CTA — semantic check via AI if available, else heuristic
  let ctaPassed = !rule || !rule.requireCTA; // no requirement = auto-pass
  if (rule && rule.requireCTA) {
    if (aiAnalysis && aiAnalysis.captionAnalysis && typeof aiAnalysis.captionAnalysis.hasCTA === 'boolean') {
      // AI semantic result — used as input, not as sole arbiter
      ctaPassed = aiAnalysis.captionAnalysis.hasCTA;
    } else {
      // Fallback: conservative heuristic CTA keywords
      const ctaKeywords = ['mua ngay', 'dat hang', 'lien he', 'inbox', 'dm', 'call', 'goi ngay', 'truy cap', 'xem them', 'dang ky', 'nhan ngay'];
      ctaPassed = ctaKeywords.some(kw => normCaption.includes(kw));
    }
  }

  // Assemble result
  const allHashtagsOk = missingHashtags.length === 0;
  const allTagsOk = missingTags.length === 0;
  const passed = allHashtagsOk && allTagsOk && productMatched && ctaPassed;

  const reasons = [];
  if (!allHashtagsOk) reasons.push(`Thiếu ${missingHashtags.length} hashtag bắt buộc: ${missingHashtags.join(', ')}`);
  if (!allTagsOk) reasons.push(`Thiếu tag Fanpage: ${missingTags.join(', ')}`);
  if (!productMatched) reasons.push(`Không đề cập tên sản phẩm (${productNames.join(' / ')})`);
  if (!ctaPassed) reasons.push('Thiếu lời kêu gọi hành động (CTA)');

  return {
    passed,
    status: passed ? 'PASSED' : 'FAILED',
    detail: {
      matchedHashtags,
      missingHashtags,
      matchedTags,
      missingTags,
      productMatched,
      ctaPassed
    },
    reason: passed
      ? `Đạt đầy đủ: hashtag (${matchedHashtags.length}/${requiredHashtags.length}), tag Fanpage, tên sản phẩm, CTA.`
      : reasons.join('. ')
  };
}

/**
 * Computes the overall evaluation result from scrape data and rules.
 * 
 * Per spec §13.3:
 *   PASSED         = ĐK1 PASSED AND ĐK2 PASSED
 *   FAILED         = Sufficient data, at least one condition clearly not met
 *   NEEDS_REVIEW   = Missing data, contradicting sources, or low confidence
 *   INACCESSIBLE   = Post cannot be accessed (private, deleted, login wall)
 *   PROCESSING_ERROR = Technical error during scraping or processing
 * 
 * @param {object} scrapeData - Result from platform adapter
 * @param {object} rule - Campaign rule object
 * @param {object|null} aiAnalysis - AI analysis result (optional, not authoritative)
 * @returns {EvaluationResult}
 */
export function computeEvaluation(scrapeData, rule, aiAnalysis = null) {
  // No data at all → processing error
  if (!scrapeData) {
    return {
      technicalStatus: 'PROCESSING_ERROR',
      businessResult: 'PROCESSING_ERROR',
      dk1: { passed: false, status: 'FAILED', reason: 'Không có dữ liệu scrape.', durationSec: null, postType: null },
      dk2: { passed: false, status: 'FAILED', reason: 'Không có dữ liệu scrape.', detail: {}, reason: '' },
      confidence: 0,
      needsManualReview: false,
      reviewReasons: ['Lỗi kỹ thuật: không có dữ liệu từ scraper.'],
      feedback: 'Lỗi kỹ thuật: scraper không trả về dữ liệu.'
    };
  }

  // Scrape failed with technical error
  if (!scrapeData.success && scrapeData.accessState === 'ERROR') {
    return {
      technicalStatus: 'PROCESSING_ERROR',
      businessResult: 'PROCESSING_ERROR',
      dk1: { passed: null, status: 'NEEDS_REVIEW', reason: `Lỗi kỹ thuật: ${scrapeData.error}`, durationSec: null, postType: null },
      dk2: { passed: null, status: 'NEEDS_REVIEW', reason: `Lỗi kỹ thuật: ${scrapeData.error}`, detail: {} },
      confidence: 0,
      needsManualReview: true,
      reviewReasons: [`Lỗi kỹ thuật: ${scrapeData.error}`],
      feedback: `Lỗi kỹ thuật khi xử lý bài viết: ${scrapeData.error}`
    };
  }

  // Inaccessible states — cannot evaluate at all
  const inaccessibleStates = ['LOGIN_REQUIRED', 'PRIVATE', 'DELETED'];
  if (inaccessibleStates.includes(scrapeData.accessState)) {
    return {
      technicalStatus: scrapeData.accessState,
      businessResult: 'INACCESSIBLE',
      dk1: { passed: null, status: 'NEEDS_REVIEW', reason: `Bài viết không thể truy cập: ${scrapeData.accessState}`, durationSec: null, postType: null },
      dk2: { passed: null, status: 'NEEDS_REVIEW', reason: `Bài viết không thể truy cập: ${scrapeData.accessState}`, detail: {} },
      confidence: 1.0,
      needsManualReview: false,
      reviewReasons: [],
      feedback: `Bài viết không thể truy cập (${scrapeData.accessState}). ${scrapeData.error || ''}`
    };
  }

  // Technical blocks — job should be paused
  const pauseStates = ['CAPTCHA', 'CHECKPOINT', 'RATE_LIMITED'];
  if (pauseStates.includes(scrapeData.accessState)) {
    return {
      technicalStatus: scrapeData.accessState,
      businessResult: 'PROCESSING_ERROR',
      dk1: { passed: null, status: 'NEEDS_REVIEW', reason: `Bị chặn: ${scrapeData.accessState}`, durationSec: null, postType: null },
      dk2: { passed: null, status: 'NEEDS_REVIEW', reason: `Bị chặn: ${scrapeData.accessState}`, detail: {} },
      confidence: 0,
      needsManualReview: true,
      reviewReasons: [`Phiên đăng nhập gặp vấn đề: ${scrapeData.accessState}`],
      feedback: `Bị chặn bởi ${scrapeData.accessState}. Vui lòng kiểm tra lại phiên đăng nhập và thử lại.`
    };
  }

  // Evaluate ĐK1 and ĐK2
  const dk1 = evaluateDk1(scrapeData, rule);
  const dk2 = evaluateDk2(scrapeData, rule, aiAnalysis);

  // Determine overall result
  const needsReview = dk1.status === 'NEEDS_REVIEW' || dk2.status === 'NEEDS_REVIEW';
  const reviewReasons = [];
  if (dk1.status === 'NEEDS_REVIEW') reviewReasons.push(dk1.reason);
  if (dk2.status === 'NEEDS_REVIEW') reviewReasons.push(dk2.reason);

  // Check AI confidence conflicts
  if (aiAnalysis && aiAnalysis.needsManualReview) {
    reviewReasons.push(...(aiAnalysis.reviewReasons || []));
  }

  let businessResult;
  let confidence;

  if (needsReview || reviewReasons.length > 0) {
    businessResult = 'NEEDS_REVIEW';
    confidence = 0.5;
  } else if (dk1.passed === true && dk2.passed === true) {
    businessResult = 'PASSED';
    confidence = 1.0;
  } else {
    // Both conditions evaluatable and at least one failed
    businessResult = 'FAILED';
    confidence = 1.0;
  }

  const feedbackParts = [];
  if (dk1.status !== 'PASSED') feedbackParts.push(`ĐK1: ${dk1.reason}`);
  if (dk2.status !== 'PASSED') feedbackParts.push(`ĐK2: ${dk2.reason}`);

  return {
    technicalStatus: 'COMPLETED',
    businessResult,
    dk1,
    dk2,
    confidence,
    needsManualReview: needsReview || reviewReasons.length > 0,
    reviewReasons,
    feedback: businessResult === 'PASSED'
      ? `Đạt đầy đủ ĐK1 và ĐK2.`
      : (businessResult === 'NEEDS_REVIEW'
        ? `Cần kiểm tra thủ công: ${reviewReasons.join('; ')}`
        : feedbackParts.join(' | '))
  };
}
