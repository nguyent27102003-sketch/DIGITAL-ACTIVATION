import assert from 'assert';
import { cleanAndParseJSON } from '../src/analyzer.js';

export async function run() {
  console.log('--- Testing cleanAndParseJSON ---');

  // Test Case 1: Clean JSON
  const case1 = '{"likes": 120, "comments": 5, "shares": null}';
  const res1 = cleanAndParseJSON(case1);
  assert.strictEqual(res1.likes, 120);
  assert.strictEqual(res1.comments, 5);
  assert.strictEqual(res1.shares, null);
  console.log('✓ Case 1: Clean JSON parsed successfully.');

  // Test Case 2: JSON wrapped in ```json ``` markdown code blocks
  const case2 = '```json\n{\n  "likes": 250,\n  "comments": 10\n}\n```';
  const res2 = cleanAndParseJSON(case2);
  assert.strictEqual(res2.likes, 250);
  assert.strictEqual(res2.comments, 10);
  console.log('✓ Case 2: Markdown ```json ``` block parsed successfully.');

  // Test Case 3: JSON wrapped in generic ``` ``` markdown code blocks
  const case3 = '```\n{\n  "likes": 500,\n  "comments": 20\n}\n```';
  const res3 = cleanAndParseJSON(case3);
  assert.strictEqual(res3.likes, 500);
  assert.strictEqual(res3.comments, 20);
  console.log('✓ Case 3: Markdown ``` block parsed successfully.');

  // Test Case 4: JSON with leading and trailing text
  const case4 = 'Some explanation first...\n{\n  "likes": 1000,\n  "comments": 30\n}\nFollowed by trailing notes...';
  const res4 = cleanAndParseJSON(case4);
  assert.strictEqual(res4.likes, 1000);
  assert.strictEqual(res4.comments, 30);
  console.log('✓ Case 4: JSON with leading and trailing text parsed successfully.');

  // Test Case 5: JSON with literal newlines inside string values (fallback parser)
  const case5 = '{\n  "imageEvaluation": {\n    "isStandard": true,\n    "reason": "Line 1\nLine 2",\n    "score": 8.5\n  }\n}';
  const res5 = cleanAndParseJSON(case5);
  assert.strictEqual(res5.imageEvaluation.isStandard, true);
  assert.strictEqual(res5.imageEvaluation.reason, 'Line 1\nLine 2');
  assert.strictEqual(res5.imageEvaluation.score, 8.5);
  console.log('✓ Case 5: JSON with literal newlines inside strings sanitized and parsed.');

  // Test Case 6: Invalid JSON structure (should throw error)
  const case6 = '{"likes": 100, comments: 2}'; // unquoted keys, bad formatting
  assert.throws(() => {
    cleanAndParseJSON(case6);
  }, /Không thể parse|SyntaxError|Failed to parse JSON/);
  console.log('✓ Case 6: Malformed JSON threw error as expected.');

  console.log('✓ All cleanAndParseJSON tests passed!\n');
}
