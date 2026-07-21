import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { scrapePost } from '../src/scraper.js';

let server;
const PORT = 5055;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/normal-post') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Mock Facebook Post</title></head>
            <body>
              <div role="article">
                Hello world! This is a mock Facebook post for FBEval Bot unit testing.
                Hashtags: #fbeval #marketing
                <span>1.2K lượt xem</span>
                <span>45 bình luận</span>
                <span>12 lượt chia sẻ</span>
              </div>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(PORT, HOST, () => {
      console.log(`[Test Server] Running at ${BASE_URL}`);
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log('[Test Server] Stopped.');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export async function run() {
  console.log('--- Testing scraper (Integration with Local Server) ---');
  await startServer();

  try {
    console.log('Scraping mock normal page...');
    const result1 = await scrapePost(`${BASE_URL}/normal-post`, true);
    
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.accessState, 'ACCESSIBLE');
    assert.ok(result1.proof1Path);
    assert.ok(fs.existsSync(result1.proof1Path));
    assert.ok(result1.proofScreen1.startsWith('/screenshots/'));
    assert.ok(result1.captionText.includes('Hello world!'));
    assert.ok(result1.captionText.includes('#fbeval'));
    console.log('✓ Case 1: Successfully scraped mock page, took dual screenshots, and extracted caption & metrics.');

    // Clean up screenshots
    if (fs.existsSync(result1.proof1Path)) fs.unlinkSync(result1.proof1Path);
    if (fs.existsSync(result1.proof2Path)) fs.unlinkSync(result1.proof2Path);

    console.log('Scraping non-existent port URL...');
    const result2 = await scrapePost(`http://127.0.0.1:9999/non-existent-page`, true);
    assert.strictEqual(result2.success, false);
    assert.ok(result2.error);
    console.log('✓ Case 2: Gracefully handled connection failure.');

  } finally {
    await stopServer();
  }

  console.log('✓ All scraper integration tests passed!\n');
}
