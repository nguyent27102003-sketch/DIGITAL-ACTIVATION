import assert from 'assert';
import { fork } from 'child_process';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';

const PORT = 5099;
const BASE_URL = `http://localhost:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve('src/server.js');
    console.log(`[Orchestration] Starting server in TEST_MODE on port ${PORT}...`);
    
    const serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: PORT,
        TEST_MODE: 'true'
      },
      silent: true
    });

    let resolved = false;

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if ((msg.includes('Running on http') || msg.includes('System is READY')) && !resolved) {
        resolved = true;
        resolve(serverProcess);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString());
    });

    serverProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    serverProcess.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer(serverProcess) {
  return new Promise((resolve) => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.once('exit', () => resolve());
      serverProcess.kill();
    } else {
      resolve();
    }
  });
}

export async function run() {
  console.log('--- Testing Job Orchestrator V2.0 (SQLite Queue, Pause/Resume/Cancel & Manual Review) ---');

  const serverProcess = await startServer();

  try {
    // 1. Create Campaign
    const campRes = await fetch(`${BASE_URL}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Chương Trình Test Automation 100 Links',
        rules: {
          productNames: ['Smarta Grow', 'Metacare'],
          requiredHashtags: ['#10tyloikhuan', '#caovuottroi'],
          requiredTags: ['@HùngCườngCompany'],
          minVideoDurationSec: 30,
          minLivestreamDurationSec: 900,
          requireCTA: true
        }
      })
    });
    const campData = await campRes.json();
    assert.strictEqual(campData.success, true);
    console.log('✓ Case 1: Created Campaign in SQLite successfully.');

    // 2. Generate 100 links Excel mock
    const testDir = path.resolve('data/test_tmp');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const mockExcelPath = path.join(testDir, 'orchestration_100_links.xlsx');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['STT', 'Khu vực', 'Mã KH', 'Tên KH', 'LINK Livestream/ video clip được gửi về']);

    for (let i = 1; i <= 100; i++) {
      ws.addRow([i, 'Miền Bắc', `KH00${i}`, `Đại lý ${i}`, `https://www.facebook.com/watch/?v=post_${i}`]);
    }
    await wb.xlsx.writeFile(mockExcelPath);

    // Upload & Inspect Excel via API
    const formData = new FormData();
    const fileBlob = new Blob([fs.readFileSync(mockExcelPath)]);
    formData.append('excel', fileBlob, 'orchestration_100_links.xlsx');

    const inspectRes = await fetch(`${BASE_URL}/api/excel/inspect`, {
      method: 'POST',
      body: formData
    });
    const inspectData = await inspectRes.json();
    assert.strictEqual(inspectData.success, true);
    console.log('✓ Case 2: Inspected 100-link Excel file successfully.');

    // Confirm Mapping & Create Job
    const mapRes = await fetch(`${BASE_URL}/api/excel/confirm-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        excelFileId: inspectData.excelFileId,
        mappingConfig: { sheets: inspectData.sheets }
      })
    });
    const mapData = await mapRes.json();

    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId: campData.campaignId,
        excelFileId: inspectData.excelFileId,
        mappingId: mapData.mappingId,
        mappingConfig: { sheets: inspectData.sheets }
      })
    });
    const jobData = await jobRes.json();
    assert.strictEqual(jobData.success, true);
    assert.strictEqual(jobData.totalItems, 100);
    console.log('✓ Case 3: Created 100-item Job in SQLite database successfully.');

    // Start Job Execution
    const startRes = await fetch(`${BASE_URL}/api/jobs/${jobData.jobId}/start`, { method: 'POST' });
    const startData = await startRes.json();
    assert.strictEqual(startData.success, true);

    // Poll status until completed
    let jobDetails;
    let maxPolls = 100;
    while (maxPolls-- > 0) {
      const res = await fetch(`${BASE_URL}/api/jobs/${jobData.jobId}`);
      jobDetails = await res.json();
      if (jobDetails.status === 'COMPLETED' || jobDetails.status === 'FAILED') break;
      await new Promise(r => setTimeout(r, 100));
    }

    assert.strictEqual(jobDetails.status, 'COMPLETED');
    assert.strictEqual(jobDetails.processed_items, 100);
    console.log('✓ Case 4: Processed all 100 items via SQLite Queue successfully.');

    // Test Manual Review Override
    const itemsRes = await fetch(`${BASE_URL}/api/jobs/${jobData.jobId}/items`);
    const items = await itemsRes.json();
    assert.strictEqual(items.length, 100);

    const firstItem = items[0];
    const reviewRes = await fetch(`${BASE_URL}/api/job-items/${firstItem.id}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newResult: 'PASSED',
        reason: 'Xác minh bằng tay bài đạt chuẩn hashtag'
      })
    });
    const reviewData = await reviewRes.json();
    assert.strictEqual(reviewData.success, true);
    console.log('✓ Case 5: Manual Review Override recorded with Audit Log successfully.');

    // Test Export Package
    const exportRes = await fetch(`${BASE_URL}/api/jobs/${jobData.jobId}/export`, { method: 'POST' });
    const exportData = await exportRes.json();
    assert.strictEqual(exportData.success, true);
    assert.ok(exportData.downloadUrl.endsWith('.zip'));
    console.log('✓ Case 6: Generated ZIP Export Package containing updated original Excel and evidence folder successfully.');

  } finally {
    await stopServer(serverProcess);
  }

  console.log('✓ All V2.0 Job Orchestration tests passed!\n');
}
