import ExcelJS from 'exceljs';
import fs from 'fs';

/**
 * Common keyword dictionaries for column auto-mapping
 */
const ALIASES = {
  customerCode: ['mã kh', 'mã khách hàng', 'customer code', 'ma kh', 'customer_code', 'code'],
  customerName: ['tên kh', 'tên khách hàng', 'customer name', 'ten kh', 'shop_name', 'cửa hàng'],
  region: ['khu vực', 'khu vuc', 'miền', 'region', 'tỉnh/tp', 'tỉnh'],
  submissionUrl: [
    'link livestream/ video clip được gửi về',
    'link livestream/ video clip',
    'link bài dự thi',
    'link livestream',
    'link video',
    'link bài post',
    'link bài viết'
  ],
  fanpageUrl: ['link fanpage/ facebook/ tiktok', 'link fanpage', 'fanpage', 'facebook fanpage', 'link shop'],
  dk1: ['đk1: thời gian livestream >=15p / video clip >=30s', 'đk1', 'thời lượng', 'thoi luong', 'dk1'],
  dk2: ['đk2: nội dung caption, gắn thẻ fanpage, hashtag', 'đk2', 'caption/hashtag', 'dk2'],
  result: ['kết quả', 'ket qua', 'trạng thái tracking', 'kết quả tracking', 'result'],
  note: ['ghi chú kq tracking', 'ghi chú', 'ghi chu', 'note', 'reason'],
  likes: ['tổng sl like/tim', 'lượt thích', 'like', 'likes', 'tim'],
  shares: ['tổng sl share', 'lượt chia sẻ', 'share', 'shares'],
  comments: ['tổng sl comment', 'lượt bình luận', 'comment', 'comments'],
  views: ['tổng sl view', 'lượt xem', 'view', 'views', 'mắt xem'],
  totalScore: ['tổng điểm đua top', 'tổng điểm', 'total score'],
  proof1: ['hình đối chiếu tracking', 'hình đối chiếu 1', 'ảnh chứng cứ 1', 'proof1'],
  proof2: ['hình đối chiếu 2', 'ảnh chứng cứ 2', 'proof2']
};

/**
 * Safely extracts plain text from ExcelJS cell values (supports string, hyperlink object, formula object, richText, numbers).
 */
function extractCellValueText(cellValue) {
  if (cellValue === null || cellValue === undefined) return '';
  if (typeof cellValue === 'string') return cellValue.trim();
  if (typeof cellValue === 'number' || typeof cellValue === 'boolean') return String(cellValue);
  if (typeof cellValue === 'object') {
    if (cellValue.hyperlink) return String(cellValue.text || cellValue.hyperlink).trim();
    if (cellValue.text) return String(cellValue.text).trim();
    if (cellValue.result !== undefined && cellValue.result !== null) return String(cellValue.result).trim();
    if (cellValue.richText && Array.isArray(cellValue.richText)) {
      return cellValue.richText.map(rt => rt.text || '').join('').trim();
    }
  }
  return String(cellValue).trim();
}

/**
 * Normalizes text for fuzzy matching.
 */
function normalizeHeader(str) {
  const text = extractCellValueText(str);
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
}

/**
 * Inspects an Excel file using ExcelJS.
 * Scans sheets, header rows, column mappings, and multi-session structures.
 * 
 * @param {string} filePath - Absolute path to uploaded Excel file
 * @returns {Promise<Object>} Inspection metadata containing sheets, mappings, and detected rows.
 */
export async function inspectExcelFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Không tìm thấy file Excel nguồn.');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetsInfo = [];

  for (const worksheet of workbook.worksheets) {
    if (worksheet.state === 'hidden') continue;

    let detectedHeaderRow = 1;
    let maxMatchCount = 0;

    const rowScanLimit = Math.min(15, worksheet.rowCount);
    for (let r = 1; r <= rowScanLimit; r++) {
      const row = worksheet.getRow(r);
      let matchCount = 0;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = normalizeHeader(cell.value);
        for (const key of Object.keys(ALIASES)) {
          if (ALIASES[key].some(alias => text.includes(normalizeHeader(alias)))) {
            matchCount++;
            break;
          }
        }
      });

      if (matchCount > maxMatchCount) {
        maxMatchCount = matchCount;
        detectedHeaderRow = r;
      }
    }

    const headerRow = worksheet.getRow(detectedHeaderRow);
    const columnsMapping = {};
    const sessions = [];

    const sessionRegex = /(phiên|phien|session)\s*(\d+)/i;
    let isMultiSession = false;

    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const headerText = String(cell.value || '').trim();
      const normText = normalizeHeader(headerText);
      const colLetter = worksheet.getColumn(colNumber).letter;

      const sessionMatch = headerText.match(sessionRegex);
      if (sessionMatch) {
        isMultiSession = true;
        const sessionNum = sessionMatch[2];
        let sessionObj = sessions.find(s => s.sessionKey === `session_${sessionNum}`);
        if (!sessionObj) {
          sessionObj = { sessionKey: `session_${sessionNum}`, sessionNum: Number(sessionNum), columns: {} };
          sessions.push(sessionObj);
        }

        for (const [key, aliasList] of Object.entries(ALIASES)) {
          if (aliasList.some(alias => normText.includes(normalizeHeader(alias)))) {
            sessionObj.columns[key] = colLetter;
          }
        }
        if (!sessionObj.columns.url && (normText.includes('link') || normText.includes('url'))) {
          sessionObj.columns.url = colLetter;
        }
      } else {
        for (const [key, aliasList] of Object.entries(ALIASES)) {
          if (!columnsMapping[key] && aliasList.some(alias => normText === normalizeHeader(alias) || normText.includes(normalizeHeader(alias)))) {
            columnsMapping[key] = colLetter;
          }
        }
      }
    });

    sheetsInfo.push({
      sheetName: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      headerRow: detectedHeaderRow,
      dataStartRow: detectedHeaderRow + 1,
      mappingType: isMultiSession ? 'MULTI_SESSION' : 'SINGLE_SESSION',
      columnsMapping,
      sessions: sessions.sort((a, b) => a.sessionNum - b.sessionNum)
    });
  }

  return {
    filePath,
    sheets: sheetsInfo
  };
}

/**
 * Extracts links & items from an inspected Excel file based on confirmed mapping.
 * 
 * @param {string} filePath - Path to Excel file
 * @param {Object} mappingConfig - Confirmed mapping configuration
 * @returns {Promise<Array<Object>>} Extracted items with row identities, URLs, and session details.
 */
export async function extractItemsFromExcel(filePath, mappingConfig) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const extractedItems = [];
  const urlRegex = /^(https?:\/\/[^\s]+)/i;

  for (const sheetConfig of mappingConfig.sheets) {
    const worksheet = workbook.getWorksheet(sheetConfig.sheetName);
    if (!worksheet) continue;

    const dataStartRow = sheetConfig.dataStartRow || (sheetConfig.headerRow + 1);

    for (let r = dataStartRow; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      if (row.cellCount === 0) continue;

      const region = sheetConfig.columnsMapping.region ? extractCellValueText(row.getCell(sheetConfig.columnsMapping.region).value) : null;
      const customerCode = sheetConfig.columnsMapping.customerCode ? extractCellValueText(row.getCell(sheetConfig.columnsMapping.customerCode).value) : null;
      const customerName = sheetConfig.columnsMapping.customerName ? extractCellValueText(row.getCell(sheetConfig.columnsMapping.customerName).value) : null;
      const fanpageUrl = sheetConfig.columnsMapping.fanpageUrl ? extractCellValueText(row.getCell(sheetConfig.columnsMapping.fanpageUrl).value) : null;

      if (sheetConfig.mappingType === 'MULTI_SESSION' && sheetConfig.sessions.length > 0) {
        for (const session of sheetConfig.sessions) {
          const urlCol = session.columns.url || session.columns.submissionUrl;
          if (!urlCol) continue;
          let rawUrl = extractCellValueText(row.getCell(urlCol).value);

          if (rawUrl && (urlRegex.test(rawUrl) || rawUrl.includes('facebook.com') || rawUrl.includes('fb.com') || rawUrl.includes('tiktok.com'))) {
            let finalUrl = rawUrl;
            if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
              finalUrl = 'https://' + rawUrl;
            }
            extractedItems.push({
              sheetName: worksheet.name,
              sourceRow: r,
              sessionKey: session.sessionKey,
              region,
              customerCode,
              customerName,
              fanpageUrl,
              sourceUrl: finalUrl
            });
          }
        }
      } else {
        const urlCol = sheetConfig.columnsMapping.submissionUrl;
        if (!urlCol) continue;
        let rawUrl = extractCellValueText(row.getCell(urlCol).value);

        if (rawUrl && (urlRegex.test(rawUrl) || rawUrl.includes('facebook.com') || rawUrl.includes('fb.com') || rawUrl.includes('tiktok.com'))) {
          let finalUrl = rawUrl;
          if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
            finalUrl = 'https://' + rawUrl;
          }
          extractedItems.push({
            sheetName: worksheet.name,
            sourceRow: r,
            sessionKey: 'session_1',
            region,
            customerCode,
            customerName,
            fanpageUrl,
            sourceUrl: finalUrl
          });
        }
      }
    }
  }

  return extractedItems;
}
