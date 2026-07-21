import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { normalizeUrl } from './platforms/urlNormalizer.js';
import { scrapeFacebookPost } from './platforms/facebookAdapter.js';
import { scrapeTikTokPost } from './platforms/tiktokAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export async function extractCookies() {
  const profileDir = path.resolve(rootDir, 'data/user_profile');
  const cookiePath = path.resolve(rootDir, 'data/cookies.json');

  if (!fs.existsSync(profileDir)) return null;

  try {
    const context = await chromium.launchPersistentContext(profileDir, { headless: true });
    const cookies = await context.cookies();
    await context.close();

    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    console.log(`Successfully saved ${cookies.length} cookies to data/cookies.json`);
    return cookies;
  } catch (err) {
    console.error('Failed to extract cookies from profile:', err);
    return null;
  }
}

export async function launchLoginBrowser() {
  const profileDir = path.resolve(rootDir, 'data/user_profile');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  console.log('Launching browser for Facebook login...');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto('https://www.facebook.com');

  await new Promise((resolve) => {
    context.on('close', resolve);
  });

  console.log('Browser closed. Saving session cookies...');
  await extractCookies();
}

/**
 * Master scraper entry point that routes URLs to platform adapters (Facebook or TikTok).
 * 
 * @param {string} rawUrl 
 * @param {boolean} headless 
 * @param {import('playwright').BrowserContext} externalContext 
 * @returns {Promise<Object>}
 */
export async function scrapePost(rawUrl, headless = true, externalContext = null) {
  const norm = normalizeUrl(rawUrl);
  if (!norm || norm.platform === 'UNSUPPORTED') {
    return {
      success: false,
      accessState: 'UNSUPPORTED_URL',
      error: 'URL không thuộc danh sách nền tảng hỗ trợ (Facebook / TikTok).'
    };
  }

  let browser = null;
  let context = externalContext;
  let ownContext = false;
  let page = null;

  try {
    if (!context) {
      ownContext = true;
      browser = await chromium.launch({ headless });
      context = await browser.newContext({
        viewport: { width: 1280, height: 1200 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      });

      const cookiePath = path.resolve(rootDir, 'data/cookies.json');
      if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
        await context.addCookies(cookies);
      }
    }

    page = await context.newPage();

    let result;
    if (norm.platform === 'TIKTOK') {
      result = await scrapeTikTokPost(page, norm.normalizedUrl);
    } else {
      result = await scrapeFacebookPost(page, norm.normalizedUrl);
    }

    result.sourceUrl = rawUrl;
    result.normalizedUrl = norm.normalizedUrl;

    return result;
  } catch (error) {
    return {
      success: false,
      accessState: 'NAVIGATION_TIMEOUT',
      error: error.message
    };
  } finally {
    if (page) {
      try { await page.close(); } catch (e) {}
    }
    if (ownContext && browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
}
