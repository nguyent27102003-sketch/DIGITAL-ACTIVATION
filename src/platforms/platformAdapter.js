/**
 * Base Platform Adapter Interface.
 * Every concrete adapter (facebookAdapter, tiktokAdapter) must implement this interface.
 *
 * Contract:
 *  - scrapePost(url, browser) → ScrapeResult
 *  - normalizeUrl(rawUrl) → string (canonical URL)
 *
 * ScrapeResult schema:
 * {
 *   success: boolean,
 *   accessState: 'ACCESSIBLE' | 'LOGIN_REQUIRED' | 'PRIVATE' | 'DELETED' | 'CAPTCHA' | 'RATE_LIMITED' | 'ERROR',
 *   platform: 'FACEBOOK' | 'TIKTOK',
 *   postType: 'Livestream' | 'Video clip' | 'Unknown' | null,
 *   durationSeconds: number | null,
 *   durationSource: 'METADATA' | 'DOM' | 'OCR' | 'AI' | null,
 *   captionText: string | null,
 *   captionSource: 'DOM' | 'OCR' | 'AI' | null,
 *   totalReactions: number | null,   // Sum of all reaction types (heart, like, etc.)
 *   likes: number | null,
 *   comments: number | null,
 *   shares: number | null,
 *   views: number | null,
 *   metricsSource: 'DOM' | 'ACCESSIBILITY' | 'OCR' | 'AI' | null,
 *   rawMetrics: object,              // Detailed source-tracked metrics
 *   pageName: string | null,
 *   pageUrl: string | null,
 *   sourceUrl: string,
 *   resolvedUrl: string | null,
 *   proof1Path: string | null,       // Absolute filesystem path to content screenshot
 *   proofScreen1: string | null,     // Relative URL for serving: /screenshots/...
 *   proof2Path: string | null,       // Absolute filesystem path to engagement screenshot
 *   proofScreen2: string | null,     // Relative URL for serving: /screenshots/...
 *   error: string | null
 * }
 */
export class PlatformAdapter {
  constructor(name) {
    if (new.target === PlatformAdapter) {
      throw new Error('PlatformAdapter is abstract and cannot be instantiated directly.');
    }
    this.name = name;
  }

  /**
   * @param {string} url - The canonical URL to scrape
   * @param {import('playwright').Browser} browser - Playwright browser instance
   * @param {object} options - Additional options (cookiesPath, headless, etc.)
   * @returns {Promise<ScrapeResult>}
   */
  async scrapePost(url, browser, options = {}) {
    throw new Error(`${this.name}.scrapePost() not implemented.`);
  }

  /**
   * @param {string} rawUrl
   * @returns {string} Normalized canonical URL
   */
  normalizeUrl(rawUrl) {
    throw new Error(`${this.name}.normalizeUrl() not implemented.`);
  }

  /**
   * Creates a standardized error result.
   */
  buildErrorResult(url, accessState, error) {
    return {
      success: false,
      accessState: accessState || 'ERROR',
      platform: this.name,
      postType: null,
      durationSeconds: null,
      durationSource: null,
      captionText: null,
      captionSource: null,
      totalReactions: null,
      likes: null,
      comments: null,
      shares: null,
      views: null,
      metricsSource: null,
      rawMetrics: {},
      pageName: null,
      pageUrl: null,
      sourceUrl: url,
      resolvedUrl: null,
      proof1Path: null,
      proofScreen1: null,
      proof2Path: null,
      proofScreen2: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  /**
   * Creates a standardized inaccessible result.
   */
  buildInaccessibleResult(url, accessState, details) {
    return {
      success: false,
      accessState: accessState,
      platform: this.name,
      postType: null,
      durationSeconds: null,
      durationSource: null,
      captionText: null,
      captionSource: null,
      totalReactions: null,
      likes: null,
      comments: null,
      shares: null,
      views: null,
      metricsSource: null,
      rawMetrics: {},
      pageName: null,
      pageUrl: null,
      sourceUrl: url,
      resolvedUrl: null,
      proof1Path: null,
      proofScreen1: null,
      proof2Path: null,
      proofScreen2: null,
      error: details || accessState
    };
  }
}
