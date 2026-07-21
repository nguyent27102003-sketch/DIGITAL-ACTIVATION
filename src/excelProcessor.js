import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

/**
 * Parses an Excel file and extracts a list of URLs/links.
 * Automatically tries to find the correct column containing URLs across all sheets.
 * 
 * @param {string} filePath - Path to the Excel file
 * @returns {Array<string>} List of URLs found
 */
export function extractLinksFromExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Không tìm thấy file Excel.');
  }

  const workbook = XLSX.readFile(filePath);
  const urlRegex = /^(https?:\/\/[^\s]+)/i;
  const links = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (!rows || rows.length === 0) continue;

    // Find columns that contain post URLs
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim();
        if (
          val &&
          (urlRegex.test(val) || val.includes('facebook.com') || val.includes('fb.com') || val.includes('tiktok.com'))
        ) {
          let finalUrl = val;
          if (!val.startsWith('http://') && !val.startsWith('https://')) {
            finalUrl = 'https://' + val;
          }
          if (!links.includes(finalUrl)) {
            links.push(finalUrl);
          }
        }
      }
    }
  }

  return links;
}

/**
 * Creates and exports a detailed report to an Excel file matching Nutricare / Hùng Cường Company's exact formatting.
 * 
 * @param {Array<Object>} results - The list of evaluated post objects
 * @param {string} outputPath - The path to save the Excel file
 */
export function exportResultsToExcel(results, outputPath) {
  const baseUrl = process.env.APP_URL || 'http://localhost:5000';

  const data = results.map((item, index) => {
    const isSuccess = item.status === 'success';
    const isDk1Passed = isSuccess ? (item.dk1 ? item.dk1.isStandard : (item.imageEvaluation ? item.imageEvaluation.isStandard : true)) : false;
    const isDk2Passed = isSuccess ? (item.dk2 ? item.dk2.isStandard : (item.contentEvaluation ? item.contentEvaluation.isStandard : true)) : false;
    const overallResult = (isSuccess && isDk1Passed && isDk2Passed) ? 'Đạt' : 'Không đạt';

    const likes = item.likes || 0;
    const shares = item.shares || 0;
    const comments = item.comments || 0;
    const views = item.views || 0;
    const totalScore = likes + shares + comments + views;

    const proof1Url = item.proofScreen1 ? `${baseUrl}${item.proofScreen1}` : (item.screenshotUrl ? `${baseUrl}${item.screenshotUrl}` : '');
    const proof2Url = item.proofScreen2 ? `${baseUrl}${item.proofScreen2}` : '';

    return {
      'STT': index + 1,
      'KHU VỰC': item.region || 'Miền Trung',
      'Mã KH': item.customerCode || `KH00${index + 1}`,
      'Tên KH': item.customerName || `Cửa hàng ${index + 1}`,
      'LINK Fanpage/ Facebook/ tiktok': item.fanpageUrl || '',
      'LINK Livestream/ video clip được gửi về': item.url,
      'ĐK1: Thời gian livestream >=15p / Video clip >=30s': isDk1Passed ? 'Đạt' : 'Không đạt',
      'ĐK2: nội dung Caption, gắn thẻ Fanpage, Hashtag': isDk2Passed ? 'Đạt' : 'Không đạt',
      'Hình đối chiếu Tracking': proof1Url,
      'Ghi chú KQ tracking': item.overallFeedback || (item.error ? `Lỗi: ${item.error}` : 'Đạt đầy đủ tiêu chí'),
      'Phân Loại: Livestream / Video clip': item.postType || 'Video clip',
      'Kết Quả': overallResult,
      'Tổng SL Like/tim': likes,
      'Tổng SL Share': shares,
      'Tổng SL Comment': comments,
      'Tổng SL View': views,
      'TỔNG ĐIỂM ĐUA TOP': totalScore,
      'Hình đối chiếu 1': proof1Url,
      'Hình đối chiếu 2': proof2Url
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Kết quả Đánh giá Tracking');

  // Set columns width for clear scannability
  worksheet['!cols'] = [
    { wch: 6 },   // STT
    { wch: 14 },  // KHU VỰC
    { wch: 12 },  // Mã KH
    { wch: 20 },  // Tên KH
    { wch: 35 },  // LINK Fanpage
    { wch: 45 },  // LINK Livestream
    { wch: 25 },  // ĐK1
    { wch: 25 },  // ĐK2
    { wch: 35 },  // Hình đối chiếu Tracking
    { wch: 40 },  // Ghi chú KQ tracking
    { wch: 18 },  // Phân loại
    { wch: 15 },  // Kết quả
    { wch: 14 },  // Like/tim
    { wch: 14 },  // Share
    { wch: 14 },  // Comment
    { wch: 14 },  // View
    { wch: 18 },  // TỔNG ĐIỂM ĐUA TOP
    { wch: 35 },  // Hình đối chiếu 1
    { wch: 35 }   // Hình đối chiếu 2
  ];

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  XLSX.writeFile(workbook, outputPath);
}
