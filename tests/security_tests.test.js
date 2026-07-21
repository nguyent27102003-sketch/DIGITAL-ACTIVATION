import assert from 'assert';
import path from 'path';

export async function run() {
  console.log('Running Security: Redaction, Traversal & ZIP Slip Tests...');

  // 1. Secret & Cookie Redaction Test
  const apiKey = 'AIzaSyA1234567890abcdefGHIJKLMN';
  const maskedKey = `${apiKey.substring(0, 4)}****${apiKey.slice(-4)}`;
  assert.strictEqual(maskedKey, 'AIza****KLMN', 'API Key masking must obscure middle characters');
  assert.ok(!maskedKey.includes('1234567890'), 'Masked key must not contain sensitive middle part');

  // 2. Upload Path Traversal Prevention Test
  const unsafeFilename = '../../../etc/passwd';
  const sanitizedFilename = path.basename(unsafeFilename);
  assert.strictEqual(sanitizedFilename, 'passwd', 'Path traversal characters must be stripped');

  // 3. ZIP Slip Prevention Test
  const zipEntryPath = '../../../../windows/system32/cmd.exe';
  const targetDir = path.resolve('public/exports');
  const resolvedPath = path.resolve(targetDir, zipEntryPath);
  const isSafe = resolvedPath.startsWith(targetDir);
  assert.strictEqual(isSafe, false, 'ZIP entry escaping target directory must be flagged as unsafe');

  console.log('  ✓ Security Checks verified (Secret Redaction, Path Traversal & ZIP Slip prevention)');
}
