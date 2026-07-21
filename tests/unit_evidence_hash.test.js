import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export async function run() {
  console.log('Running Unit: Evidence Hash Test...');

  const tempFile = path.join(process.cwd(), 'data/temp_evidence_test.png');
  const testContent = Buffer.from('FAKE_PNG_BINARY_DATA_FOR_HASH_TEST_' + Date.now());

  fs.writeFileSync(tempFile, testContent);

  const hash = crypto.createHash('sha256').update(testContent).digest('hex');
  const readHash = crypto.createHash('sha256').update(fs.readFileSync(tempFile)).digest('hex');

  assert.strictEqual(readHash, hash, 'Computed file hash does not match binary content.');
  assert.strictEqual(hash.length, 64, 'SHA-256 hash length must be 64 hexadecimal characters.');

  fs.unlinkSync(tempFile);
  console.log('  ✓ Evidence SHA-256 Hash calculation verified');
}
