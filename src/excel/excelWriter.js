import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const archiverRaw = require('archiver');

function createArchiveInstance(format, options) {
  if (typeof archiverRaw === 'function') {
    return archiverRaw(format, options);
  }
  if (archiverRaw.ZipArchive && (format === 'zip' || !format)) {
    return new archiverRaw.ZipArchive(options);
  }
  if (archiverRaw.Archiver) {
    return new archiverRaw.Archiver(format, options);
  }
  throw new Error(`Cannot initialize archiver.`);
}

/**
 * Writes evaluation results directly into a copy of the original Excel workbook.
 * Preserves all original sheets, formulas, formatting, font colors, borders, and merged cells.
 * 
 * @param {string} sourceExcelPath - Path to the original uploaded Excel file
 * @param {string} outputExcelPath - Path to save the updated Excel file
 * @param {Object} mappingConfig - Confirmed mapping configuration
 * @param {Array<Object>} jobItemsWithResults - Evaluated items with sourceRow, sheetName, sessionKey & evaluation results
 */
export async function writeResultsToOriginalExcel(sourceExcelPath, outputExcelPath, mappingConfig, jobItemsWithResults) {
  if (!fs.existsSync(sourceExcelPath)) {
    throw new Error(`File Excel gốc không tồn tại: ${sourceExcelPath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourceExcelPath);

  // Group results by sheetName and sourceRow
  for (const sheetConfig of mappingConfig.sheets) {
    const worksheet = workbook.getWorksheet(sheetConfig.sheetName);
    if (!worksheet) continue;

    const sheetItems = jobItemsWithResults.filter(item => item.sheet_name === sheetConfig.sheetName || item.sheetName === sheetConfig.sheetName);

    for (const item of sheetItems) {
      const rowNum = item.source_row || item.sourceRow;
      const row = worksheet.getRow(rowNum);

      let cols = {};
      if (sheetConfig.mappingType === 'MULTI_SESSION' && sheetConfig.sessions.length > 0) {
        const session = sheetConfig.sessions.find(s => s.sessionKey === item.session_key || s.sessionKey === item.sessionKey);
        if (session) {
          cols = session.columns;
        }
      } else {
        cols = sheetConfig.columnsMapping;
      }

      // Write results into target cells
      const dk1Text = item.dk1_passed === 1 ? 'Đạt' : (item.dk1_passed === 0 ? 'Không đạt' : 'Chờ kiểm tra');
      const dk2Text = item.dk2_passed === 1 ? 'Đạt' : (item.dk2_passed === 0 ? 'Không đạt' : 'Chờ kiểm tra');
      const resultText = item.business_result === 'PASSED' ? 'ĐẠT' : (item.business_result === 'FAILED' ? 'KHÔNG ĐẠT' : (item.business_result === 'NEEDS_REVIEW' ? 'Chờ kiểm tra' : 'Lỗi xử lý'));

      if (cols.dk1) row.getCell(cols.dk1).value = dk1Text;
      if (cols.dk2) row.getCell(cols.dk2).value = dk2Text;
      if (cols.result) row.getCell(cols.result).value = resultText;
      if (cols.note && item.feedback) row.getCell(cols.note).value = item.feedback;
      if (cols.likes && item.likes !== null && item.likes !== undefined) row.getCell(cols.likes).value = item.likes;
      if (cols.shares && item.shares !== null && item.shares !== undefined) row.getCell(cols.shares).value = item.shares;
      if (cols.comments && item.comments !== null && item.comments !== undefined) row.getCell(cols.comments).value = item.comments;
      if (cols.views && item.views !== null && item.views !== undefined) row.getCell(cols.views).value = item.views;

      // Write relative hyperlink to evidence if available
      if (cols.proof1 && item.proofScreen1) {
        row.getCell(cols.proof1).value = {
          text: 'Xem Ảnh Bằng Chứng 1',
          hyperlink: item.relativeProof1 || item.proofScreen1
        };
      }
      if (cols.proof2 && item.proofScreen2) {
        row.getCell(cols.proof2).value = {
          text: 'Xem Ảnh Bằng Chứng 2',
          hyperlink: item.relativeProof2 || item.proofScreen2
        };
      }

      row.commit();
    }
  }

  const outputDir = path.dirname(outputExcelPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await workbook.xlsx.writeFile(outputExcelPath);
  return outputExcelPath;
}

/**
 * Creates a mobile export package (ZIP) containing the updated Excel file and the evidence/ directory with relative hyperlinks.
 * 
 * @param {string} excelFilePath - Path to updated Excel file
 * @param {Array<Object>} evidenceFiles - Array of evidence file objects with filePath and evidenceType
 * @param {string} zipOutputPath - Output path for ZIP file
 * @returns {Promise<string>} Path to generated ZIP package
 */
export async function createExportPackageZip(excelFilePath, evidenceFiles, zipOutputPath) {
  return new Promise((resolve, reject) => {
    try {
      const outputDir = path.dirname(zipOutputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const output = fs.createWriteStream(zipOutputPath);
      const archive = createArchiveInstance('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve(zipOutputPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Append updated Excel file
      archive.file(excelFilePath, { name: 'Bao_cao_tracking_activation.xlsx' });

      // Append evidence files under evidence/ directory
      if (evidenceFiles && Array.isArray(evidenceFiles)) {
        for (const ev of evidenceFiles) {
          if (fs.existsSync(ev.file_path || ev.filePath)) {
            const filename = path.basename(ev.file_path || ev.filePath);
            archive.file(ev.file_path || ev.filePath, { name: `evidence/${filename}` });
          }
        }
      }

      archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}
