import assert from 'assert';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { inspectExcelFile, extractItemsFromExcel } from '../src/excel/excelInspector.js';
import { writeResultsToOriginalExcel, createExportPackageZip } from '../src/excel/excelWriter.js';

export async function run() {
  console.log('--- Testing excelInspector & excelWriter (V2.0 Engine) ---');

  const testDir = path.resolve('data/test_tmp');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const mockExcelPath = path.join(testDir, 'mock_tracking_campaign.xlsx');
  const outputExcelPath = path.join(testDir, 'output_tracking_campaign.xlsx');
  const outputZipPath = path.join(testDir, 'export_package.zip');

  // Create a realistic mock Excel file with original styles, header rows, merged cells and multiple rows
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bảng Tracking Đua Top');

  sheet.addRow(['CHƯƠNG TRÌNH KÍCH HOẠT DOANH SỐ SMARTA GROW OPTI THÁNG 6']);
  sheet.addRow(['BẢNG PHÂN TÍCH VÀ ĐÁNH GIÁ CHI TIẾT BÀI VIẾT KHU VỰC']);
  sheet.addRow([]);

  // Header Row at Line 4
  const headerRow = sheet.addRow([
    'STT', 'KHU VỰC', 'Mã KH', 'Tên KH', 
    'LINK Fanpage/ Facebook/ tiktok', 'LINK Livestream/ video clip được gửi về', 
    'ĐK1: Thời gian livestream >=15p / Video clip >=30s', 'ĐK2: nội dung Caption, gắn thẻ Fanpage, Hashtag',
    'Hình đối chiếu Tracking', 'Ghi chú KQ tracking', 'Phân Loại: Livestream / Video clip',
    'Kết Quả', 'Tổng SL Like/tim', 'Tổng SL Share', 'Tổng SL Comment', 'Tổng SL View', 'TỔNG ĐIỂM ĐUA TOP'
  ]);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

  // Data rows
  sheet.addRow([1, 'Miền Trung', 'KH001', 'Cửa hàng Minh Khai', 'https://facebook.com/minhkhai', 'https://facebook.com/watch/?v=101', '', '', '', '', '', '', 0, 0, 0, 0, 0]);
  sheet.addRow([2, 'Miền Bắc', 'KH002', 'Đại lý Hương Sơn', 'https://facebook.com/huongson', 'https://www.tiktok.com/@huongson/video/202', '', '', '', '', '', '', 0, 0, 0, 0, 0]);

  await workbook.xlsx.writeFile(mockExcelPath);
  console.log('✓ Case 1: Created realistic mock Excel file with styles & header row at line 4.');

  // 1. Inspect Excel file
  const inspection = await inspectExcelFile(mockExcelPath);
  assert.strictEqual(inspection.sheets.length, 1);
  assert.strictEqual(inspection.sheets[0].headerRow, 4);
  assert.strictEqual(inspection.sheets[0].columnsMapping.submissionUrl, 'F');
  console.log('✓ Case 2: excelInspector detected header row (row 4) and URL column (column F) correctly.');

  // 2. Extract Items
  const items = await extractItemsFromExcel(mockExcelPath, { sheets: inspection.sheets });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].sourceRow, 5);
  assert.strictEqual(items[0].customerCode, 'KH001');
  assert.strictEqual(items[1].sourceRow, 6);
  assert.strictEqual(items[1].customerCode, 'KH002');
  console.log('✓ Case 3: extractItemsFromExcel extracted items preserving exact sourceRow and customerCode.');

  // 3. Write results back to original Excel copy
  const jobItemsWithResults = [
    {
      sheetName: 'Bảng Tracking Đua Top',
      sourceRow: 5,
      sessionKey: 'session_1',
      dk1_passed: 1,
      dk2_passed: 1,
      business_result: 'PASSED',
      feedback: 'Đạt đầy đủ tiêu chí',
      likes: 150,
      shares: 10,
      comments: 25,
      views: 3200,
      proofScreen1: '/screenshots/mock.png',
      proofScreen2: '/screenshots/mock.png'
    },
    {
      sheetName: 'Bảng Tracking Đua Top',
      sourceRow: 6,
      sessionKey: 'session_1',
      dk1_passed: 0,
      dk2_passed: 1,
      business_result: 'FAILED',
      feedback: 'Thời lượng video không đủ',
      likes: 20,
      shares: 1,
      comments: 2,
      views: 100,
      proofScreen1: '/screenshots/mock.png',
      proofScreen2: '/screenshots/mock.png'
    }
  ];

  await writeResultsToOriginalExcel(mockExcelPath, outputExcelPath, { sheets: inspection.sheets }, jobItemsWithResults);
  assert.ok(fs.existsSync(outputExcelPath));

  const verifyWb = new ExcelJS.Workbook();
  await verifyWb.xlsx.readFile(outputExcelPath);
  const verifySheet = verifyWb.getWorksheet('Bảng Tracking Đua Top');
  
  assert.strictEqual(verifySheet.getRow(5).getCell('G').value, 'Đạt');
  assert.strictEqual(verifySheet.getRow(5).getCell('L').value, 'ĐẠT');
  assert.strictEqual(verifySheet.getRow(5).getCell('M').value, 150);

  assert.strictEqual(verifySheet.getRow(6).getCell('G').value, 'Không đạt');
  assert.strictEqual(verifySheet.getRow(6).getCell('L').value, 'KHÔNG ĐẠT');
  console.log('✓ Case 4: writeResultsToOriginalExcel updated exact target cells maintaining original styles.');

  // 4. Create Export ZIP Package
  await createExportPackageZip(outputExcelPath, [], outputZipPath);
  assert.ok(fs.existsSync(outputZipPath));
  console.log('✓ Case 5: createExportPackageZip generated export ZIP package successfully.');

  console.log('✓ All excelInspector & excelWriter tests passed!\n');
}
