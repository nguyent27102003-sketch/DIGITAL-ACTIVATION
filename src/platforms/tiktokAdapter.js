import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { detectAccessState, mapAccessStateToBusinessResult } from './accessStateDetector.js';
import { parseMetric, parseDuration } from './metricParser.js';
import { PlatformAdapter } from './platformAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

/**
 * TikTok Platform Adapter — Precision Scraper
 * 
 * Per spec §8.2:
 *  - Bounded container extraction (not document.body.innerText)
 *  - Scroll via locator (not window.scrollBy)
 *  - Per-field source tracking
 *  - Dual proof screenshots
 *  - Access state detection
 */
class TikTokAdapter extends PlatformAdapter {
  constructor() {
    super('TIKTOK');
  }

  normalizeUrl(rawUrl) {
    try {
      if (!rawUrl) return null;
      let url = rawUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const parsed = new URL(url);
      const STRIP = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref_src', 'refer'];
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
    const proof1Filename = `proof1_tt_${ts}_${suffix}.png`;
    const proof2Filename = `proof2_tt_${ts}_${suffix}.png`;
    const proof1Path = path.join(screenshotDir, proof1Filename);
    const proof2Path = path.join(screenshotDir, proof2Filename);

    let context, page;
    try {
      context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      page = await context.newPage();

      const resolvedUrl = this.normalizeUrl(url);
      await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);

      const currentUrl = page.url();
      const title = await page.title();
      const bodySnippet = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 2000) : '');
      const accessState = detectAccessState(currentUrl, title, bodySnippet, 200);
      const accessMapping = mapAccessStateToBusinessResult(accessState);

      if (accessState !== 'ACCESSIBLE') {
        return {
          ...this.buildInaccessibleResult(url, accessState, title),
          resolvedUrl: currentUrl,
          shouldPauseJob: accessMapping.shouldPauseJob
        };
      }

      // PROOF 1 — Content screenshot (video + caption area)
      await page.screenshot({ path: proof1Path, fullPage: false });
      const proof1Hash = crypto.createHash('sha256').update(fs.readFileSync(proof1Path)).digest('hex');

      // Scroll to engagement bar using locator (NOT window.scrollBy)
      try {
        const engagementLocator = page.locator(
          '[data-e2e="like-count"], [data-e2e="comment-count"], [data-e2e="share-count"]'
        ).first();
        if (await engagementLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
          await engagementLocator.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(600);
        }
      } catch (_) {}

      // PROOF 2 — Engagement screenshot
      await page.screenshot({ path: proof2Path, fullPage: false });
      const proof2Hash = crypto.createHash('sha256').update(fs.readFileSync(proof2Path)).digest('hex');

      // Bounded DOM extraction
      const extracted = await page.evaluate(() => {
        // TikTok video container selectors
        const CONTAINER_SELECTORS = [
          'div[data-e2e="video-desc"]',
          'div[class*="DivInfoContainer"]',
          'main',
          'div[class*="video-info"]'
        ];

        let container = null;
        for (const sel of CONTAINER_SELECTORS) {
          const el = document.querySelector(sel);
          if (el) { container = el; break; }
        }

        const captionText = container ? (container.innerText || '') : '';

        // TikTok engagement metrics — structured data attributes
        const likeEl = document.querySelector('[data-e2e="like-count"]');
        const commentEl = document.querySelector('[data-e2e="comment-count"]');
        const shareEl = document.querySelector('[data-e2e="share-count"]');
        const viewEl = document.querySelector('[data-e2e="video-views"]');

        // Duration from video element
        const videoEl = document.querySelector('video');
        const durationSeconds = videoEl && !isNaN(videoEl.duration) ? Math.round(videoEl.duration) : null;

        return {
          captionText,
          durationSeconds,
          rawLikes: likeEl ? likeEl.innerText : null,
          rawComments: commentEl ? commentEl.innerText : null,
          rawShares: shareEl ? shareEl.innerText : null,
          rawViews: viewEl ? viewEl.innerText : null
        };
      });

      const likesMetric = parseMetric(extracted.rawLikes, 'DOM', '[data-e2e="like-count"]');
      const commentsMetric = parseMetric(extracted.rawComments, 'DOM', '[data-e2e="comment-count"]');
      const sharesMetric = parseMetric(extracted.rawShares, 'DOM', '[data-e2e="share-count"]');
      const viewsMetric = parseMetric(extracted.rawViews, 'DOM', '[data-e2e="video-views"]');
      
      const durationValue = extracted.durationSeconds !== null
        ? extracted.durationSeconds
        : null;

      return {
        success: true,
        accessState: 'ACCESSIBLE',
        platform: 'TIKTOK',
        postType: 'Video clip',
        durationSeconds: durationValue,
        durationSource: durationValue !== null ? 'METADATA' : null,
        captionText: extracted.captionText || null,
        captionSource: extracted.captionText ? 'DOM' : null,
        totalReactions: likesMetric.value,
        likes: likesMetric.value,
        comments: commentsMetric.value,
        shares: sharesMetric.value,
        views: viewsMetric.value,
        metricsSource: 'DOM',
        rawMetrics: {
          likes: likesMetric,
          comments: commentsMetric,
          shares: sharesMetric,
          views: viewsMetric
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

export const tiktokAdapter = new TikTokAdapter();

// Legacy export for scraper.js compatibility
export async function scrapeTikTokPost(page, url) {
  return tiktokAdapter.scrapePost(url, page?.context()?.browser?.() || null, {});
}
