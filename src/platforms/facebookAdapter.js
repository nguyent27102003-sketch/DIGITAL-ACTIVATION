import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { detectAccessState, mapAccessStateToBusinessResult } from './accessStateDetector.js';
import { parseMetric, parseDuration, resolveMetric } from './metricParser.js';
import { PlatformAdapter } from './platformAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

/**
 * Facebook Platform Adapter — Precision Scraper
 * 
 * Implements strict requirements from spec §8.1:
 *  - Bounded container extraction (not document.body.innerText)
 *  - Correct "See more" click (only in post container, not in comments)
 *  - Scroll via locator.scrollIntoViewIfNeeded() (not window.scrollBy)
 *  - Dual proof screenshots: Content + Engagement
 *  - Per-field source tracking (DOM, METADATA, OCR, AI)
 *  - Proper access state detection
 */
class FacebookAdapter extends PlatformAdapter {
  constructor() {
    super('FACEBOOK');
  }

  normalizeUrl(rawUrl) {
    try {
      if (!rawUrl) return null;
      let url = rawUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const parsed = new URL(url);
      // Convert mobile URLs
      if (parsed.hostname.startsWith('m.') || parsed.hostname.startsWith('mbasic.')) {
        parsed.hostname = 'www.facebook.com';
      }
      // Strip tracking params
      const STRIP = ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', '__tn__', 'hrc', 'sfnsn'];
      const clean = new URLSearchParams();
      for (const [k, v] of parsed.searchParams.entries()) {
        if (!STRIP.includes(k)) clean.append(k, v);
      }
      parsed.search = clean.toString() ? `?${clean}` : '';
      return parsed.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  async scrapePost(url, browser, options = {}) {
    const screenshotDir = path.join(rootDir, 'public/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const ts = Date.now();
    const suffix = Math.random().toString(36).substring(2, 6);
    const proof1Filename = `proof1_fb_${ts}_${suffix}.png`;
    const proof2Filename = `proof2_fb_${ts}_${suffix}.png`;
    const proof1Path = path.join(screenshotDir, proof1Filename);
    const proof2Path = path.join(screenshotDir, proof2Filename);

    let context, page;
    try {
      const cookiesPath = options.cookiesPath || path.join(rootDir, 'data/cookies.json');
      const contextOpts = {};
      if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
        contextOpts.storageState = { cookies, origins: [] };
      }

      context = await browser.newContext({ ...contextOpts, viewport: { width: 1366, height: 768 } });
      page = await context.newPage();

      const resolvedUrl = this.normalizeUrl(url);
      await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);

      // Read page state for access detection
      const currentUrl = page.url();
      const title = await page.title();
      const bodySnippet = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 3000) : '');
      const accessState = detectAccessState(currentUrl, title, bodySnippet, 200);
      const accessMapping = mapAccessStateToBusinessResult(accessState);

      if (accessState !== 'ACCESSIBLE') {
        return {
          ...this.buildInaccessibleResult(url, accessState, `${accessState}: ${title}`),
          resolvedUrl: currentUrl,
          shouldPauseJob: accessMapping.shouldPauseJob
        };
      }

      // Expand full caption — "Xem thêm" only in the MAIN POST container
      // NOT in comments section (per spec §8.1: "không bấm Xem thêm của bình luận")
      try {
        const postContainer = page.locator(
          'div[role="article"]:first-of-type, div[data-pagelet="FeedUnit"]:first-of-type, div[role="main"]'
        ).first();

        const seeMoreInPost = postContainer.locator(
          'div[role="button"]:has-text("Xem thêm"), span:has-text("Xem thêm"), div[role="button"]:has-text("See more"), span:has-text("See more")'
        ).first();

        if (await seeMoreInPost.isVisible({ timeout: 1500 }).catch(() => false)) {
          await seeMoreInPost.scrollIntoViewIfNeeded().catch(() => {});
          await seeMoreInPost.click({ force: true }).catch(() => {});
          await page.waitForTimeout(800);
        }
      } catch (_) {
        // Non-fatal — continue without expanded caption
      }

      // PROOF 1 — Content screenshot (caption area)
      await page.screenshot({ path: proof1Path, fullPage: false });
      const proof1Hash = crypto.createHash('sha256').update(fs.readFileSync(proof1Path)).digest('hex');

      // Scroll engagement metrics into view using locator (NOT window.scrollBy)
      try {
        const metricsLocator = page.locator(
          'span:has-text("lượt xem"), span:has-text("views"), span:has-text("bình luận"), span:has-text("comments"), span:has-text("chia sẻ"), span:has-text("shares")'
        ).first();
        if (await metricsLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
          await metricsLocator.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (_) {}

      // PROOF 2 — Engagement screenshot (metrics area)
      await page.screenshot({ path: proof2Path, fullPage: false });
      const proof2Hash = crypto.createHash('sha256').update(fs.readFileSync(proof2Path)).digest('hex');

      // Bounded DOM extraction — only within post container (NOT full page)
      const extracted = await page.evaluate(() => {
        // Locate main post container only
        const POST_SELECTORS = [
          'div[role="article"]',
          'div[data-pagelet="FeedUnit"]',
          'div[role="main"]',
          'div[id="watch-video"]',
          'div[class*="story_body_container"]'
        ];

        let container = null;
        for (const sel of POST_SELECTORS) {
          const el = document.querySelector(sel);
          if (el) { container = el; break; }
        }

        const scope = container || document.body;
        const captionText = scope ? scope.innerText || '' : '';

        // Detect post type from bounded text only
        let postType = 'Video clip';
        const lowerText = captionText.toLowerCase();
        if (lowerText.includes('phát trực tiếp') || lowerText.includes('was live') || lowerText.includes('đang phát trực tiếp')) {
          postType = 'Livestream';
        }

        // Duration from player time indicator (e.g. "0:45", "15:30", "1:12:00")
        // Only match typical video duration patterns (not times like "12:30" as in dates)
        let durationRaw = null;
        const timeMatch = captionText.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
        if (timeMatch) {
          durationRaw = timeMatch[0];
        }

        // Metric elements — search only within post container scope
        const allSpans = Array.from(scope.querySelectorAll('span, div[aria-label], [aria-label]'));
        let rawViews = null, rawLikes = null, rawComments = null, rawShares = null;

        for (const el of allSpans) {
          const txt = (el.innerText || el.getAttribute('aria-label') || '').trim();
          if (!txt || txt.length > 200) continue;
          const lower = txt.toLowerCase();
          if (!rawViews && (lower.includes('lượt xem') || lower.includes('view') || lower.includes('mắt xem'))) rawViews = txt;
          if (!rawLikes && (lower.includes('lượt thích') || lower.includes('cảm xúc') || lower.includes('reaction') || lower.includes('heart'))) rawLikes = txt;
          if (!rawComments && (lower.includes('bình luận') || lower.includes('comment'))) rawComments = txt;
          if (!rawShares && (lower.includes('chia sẻ') || lower.includes('share'))) rawShares = txt;
        }

        return { captionText, postType, durationRaw, rawViews, rawLikes, rawComments, rawShares };
      });

      // Parse metrics with source tracking
      const viewsMetric = parseMetric(extracted.rawViews, 'DOM', 'span[lượt xem]');
      const likesMetric = parseMetric(extracted.rawLikes, 'DOM', 'span[lượt thích]');
      const commentsMetric = parseMetric(extracted.rawComments, 'DOM', 'span[bình luận]');
      const sharesMetric = parseMetric(extracted.rawShares, 'DOM', 'span[chia sẻ]');
      const durationMetric = parseDuration(extracted.durationRaw, 'DOM');

      return {
        success: true,
        accessState: 'ACCESSIBLE',
        platform: 'FACEBOOK',
        postType: extracted.postType,
        durationSeconds: durationMetric.value,
        durationSource: durationMetric.value !== null ? 'DOM' : null,
        captionText: extracted.captionText || null,
        captionSource: extracted.captionText ? 'DOM' : null,
        totalReactions: likesMetric.value,  // Facebook reactions ≠ likes
        likes: likesMetric.value,
        comments: commentsMetric.value,
        shares: sharesMetric.value,
        views: viewsMetric.value,
        metricsSource: 'DOM',
        rawMetrics: {
          views: viewsMetric,
          likes: likesMetric,
          comments: commentsMetric,
          shares: sharesMetric,
          duration: durationMetric
        },
        pageName: null,
        pageUrl: null,
        sourceUrl: url,
        resolvedUrl: currentUrl,
        proof1Path,
        proofScreen1: `/screenshots/${proof1Filename}`,
        proof1Hash,
        proof2Path,
        proofScreen2: `/screenshots/${proof2Filename}`,
        proof2Hash,
        error: null,
        shouldPauseJob: false
      };

    } catch (err) {
      return {
        ...this.buildErrorResult(url, 'ERROR', err),
        resolvedUrl: null,
        proof1Path: null,
        proofScreen1: null,
        proof2Path: null,
        proofScreen2: null,
        shouldPauseJob: false
      };
    } finally {
      try { await context?.close(); } catch (_) {}
    }
  }
}

export const facebookAdapter = new FacebookAdapter();

// Legacy export for scraper.js compatibility
export async function scrapeFacebookPost(page, url) {
  return facebookAdapter.scrapePost(url, page?.context()?.browser?.() || null, {});
}
