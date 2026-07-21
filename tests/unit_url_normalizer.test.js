/**
 * Unit Tests: URL Normalizer
 * Tests Facebook/TikTok URL normalization per spec §8.1, §8.2.
 */
import assert from 'assert';
import { normalizeUrl } from '../src/platforms/urlNormalizer.js';

export async function run() {
  console.log('--- Unit: URL Normalizer ---');

  // Facebook permalink
  let res = normalizeUrl('https://www.facebook.com/watch/?v=123456789');
  assert.strictEqual(res.platform, 'FACEBOOK');
  assert.ok(res.normalizedUrl.includes('facebook.com'));

  // Facebook tracking params stripped
  res = normalizeUrl('https://www.facebook.com/photo/?fbid=123&fbclid=IwABC&utm_source=share&ref=emv');
  assert.strictEqual(res.platform, 'FACEBOOK');
  assert.ok(!res.normalizedUrl.includes('fbclid'), 'fbclid should be stripped');
  assert.ok(!res.normalizedUrl.includes('utm_source'), 'utm_source should be stripped');
  assert.ok(!res.normalizedUrl.includes('ref='), 'ref should be stripped');
  console.log('✓ Facebook: tracking params stripped (fbclid, utm_*, ref)');

  // Mobile Facebook URL → normalized to www
  res = normalizeUrl('https://m.facebook.com/watch/?v=987654321');
  assert.strictEqual(res.platform, 'FACEBOOK');
  assert.ok(res.normalizedUrl.includes('www.facebook.com'), 'm.facebook.com should convert to www.facebook.com');
  console.log('✓ Facebook: mobile URL (m.facebook.com → www.facebook.com)');

  // fb.watch short URL
  res = normalizeUrl('https://fb.watch/abcdef123/');
  assert.strictEqual(res.platform, 'FACEBOOK');
  console.log('✓ Facebook: fb.watch short URL');

  // TikTok video URL
  res = normalizeUrl('https://www.tiktok.com/@user123/video/7234567890123456789');
  assert.strictEqual(res.platform, 'TIKTOK');
  console.log('✓ TikTok: standard video URL');

  // TikTok with tracking params
  res = normalizeUrl('https://www.tiktok.com/@user/video/123?utm_campaign=test&utm_source=share');
  assert.strictEqual(res.platform, 'TIKTOK');
  assert.ok(!res.normalizedUrl.includes('utm_campaign'));
  console.log('✓ TikTok: tracking params stripped');

  // Localhost (for integration test server)
  res = normalizeUrl('http://127.0.0.1:5055/normal-post');
  assert.strictEqual(res.platform, 'FACEBOOK'); // localhost treated as FB for testing
  console.log('✓ Localhost: treated as FACEBOOK for integration tests');

  // Unsupported platform
  res = normalizeUrl('https://youtube.com/watch?v=abc');
  assert.strictEqual(res.platform, 'UNSUPPORTED');
  console.log('✓ Unsupported: YouTube returns UNSUPPORTED platform');

  // Invalid / empty
  res = normalizeUrl(null);
  assert.strictEqual(res, null);

  res = normalizeUrl('');
  assert.strictEqual(res, null);
  console.log('✓ Invalid: null/empty returns null');

  // No protocol → auto-add https://
  res = normalizeUrl('www.facebook.com/watch/?v=999');
  assert.strictEqual(res.platform, 'FACEBOOK');
  assert.ok(res.normalizedUrl.startsWith('https://'));
  console.log('✓ Auto-protocol: no protocol prefix → https:// added');

  console.log('✓ All URL Normalizer tests passed!\n');
}
