/**
 * URL Normalizer for Facebook, TikTok, and Localhost links.
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let urlStr = rawUrl.trim();
  if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
    urlStr = 'https://' + urlStr;
  }

  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    // Identify Platform
    let platform = 'FACEBOOK';
    if (hostname.includes('tiktok.com')) {
      platform = 'TIKTOK';
    } else if (
      hostname.includes('127.0.0.1') || 
      hostname.includes('localhost') || 
      hostname.includes('facebook.com') || 
      hostname.includes('fb.com') || 
      hostname.includes('fb.watch')
    ) {
      platform = 'FACEBOOK';
    } else {
      return {
        platform: 'UNSUPPORTED',
        sourceUrl: rawUrl,
        normalizedUrl: urlStr
      };
    }

    // Strip tracking parameters
    const cleanParams = new URLSearchParams();
    for (const [key, val] of parsed.searchParams.entries()) {
      if (!['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'ref', '__tn__', 'hrc', 'sfnsn'].includes(key)) {
        cleanParams.append(key, val);
      }
    }

    parsed.search = cleanParams.toString() ? `?${cleanParams.toString()}` : '';

    // Convert m.facebook.com or mbasic.facebook.com to www.facebook.com
    if (hostname.startsWith('m.') || hostname.startsWith('mbasic.')) {
      parsed.hostname = 'www.facebook.com';
    }

    return {
      platform,
      sourceUrl: rawUrl,
      normalizedUrl: parsed.toString()
    };
  } catch (err) {
    return {
      platform: 'UNKNOWN',
      sourceUrl: rawUrl,
      normalizedUrl: rawUrl
    };
  }
}
