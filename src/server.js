import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import db from './db/index.js';
import { launchLoginBrowser, scrapePost } from './scraper.js';
import { analyzePost, extractRulesFromPoster } from './analyzer.js';
import { inspectExcelFile, extractItemsFromExcel } from './excel/excelInspector.js';
import { writeResultsToOriginalExcel, createExportPackageZip } from './excel/excelWriter.js';
import { computeEvaluation } from './engine/evaluationEngine.js';
import {
  runJobRecovery,
  acquireItemLock,
  releaseItemLock,
  updateHeartbeat,
  mapAccessStateToItemStatus,
  getRetryDelayMs
} from './jobs/jobRecoveryService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SERVER_INSTANCE_ID = `server_${process.pid}_${Date.now()}`;
let isSystemReady = false;
let recoveryStats = { recovered: 0, skipped: 0, errors: 0 };

import authRoutes from './auth/authRoutes.js';
import { requireAuthentication, requireApprovedUser, requireRole } from './auth/authMiddleware.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Cookie parsing middleware
app.use((req, res, next) => {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
    });
  }
  req.cookies = list;
  next();
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Dữ liệu JSON không hợp lệ.' });
  }
  next(err);
});

// Static file directories
app.use('/screenshots', express.static(path.join(rootDir, 'public/screenshots')));
app.use('/exports', express.static(path.join(rootDir, 'public/exports')));
app.use(express.static(path.join(rootDir, 'frontend/dist')));

// Mount Auth & Admin Routes
app.use('/api', authRoutes);

// Configure Multer for uploads
const uploadDir = path.join(rootDir, 'data/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// System Ready Middleware
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path === '/config-status' || req.path === '/health') return next();
  if (!isSystemReady) {
    return res.status(503).json({
      success: false,
      error: 'Hệ thống đang khởi động và khôi phục dữ liệu (Job Recovery)... Vui lòng thử lại sau giây lát.'
    });
  }
  next();
});

// Helper to create audit logs
function createAuditLog(actorType, actorId, action, entityType, entityId, beforeObj = null, afterObj = null, reason = null) {
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    db.prepare(`
      INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      actorType || 'USER',
      actorId || 'USER',
      action,
      entityType,
      entityId,
      beforeObj ? JSON.stringify(beforeObj) : null,
      afterObj ? JSON.stringify(afterObj) : null,
      reason || null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[AuditLog] Failed to record audit log:', err.message);
  }
}

// Helper to create notifications
function createNotification(type, level, title, message, jobId = null, itemId = null, dedupeKey = null) {
  try {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const finalDedupe = dedupeKey || `${type}_${jobId || ''}_${itemId || ''}_${Date.now()}`;
    db.prepare(`
      INSERT INTO notifications (id, user_id, job_id, job_item_id, type, level, title, message, dedupe_key, created_at)
      VALUES (?, 'USER', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `).run(
      id, jobId, itemId, type, level, title, message, finalDedupe, new Date().toISOString()
    );
  } catch (err) {
    console.error('[Notification] Failed to record notification:', err.message);
  }
}

// Helper to calculate file SHA-256 hash
function computeFileHash(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buf).digest('hex');
    }
  } catch (_) {}
  return 'hash_placeholder_' + Date.now();
}

// System Health & Status
app.get('/api/config-status', (req, res) => {
  const rawKey = process.env.GEMINI_API_KEY || '';
  const maskedKey = rawKey ? `${rawKey.substring(0, 4)}****${rawKey.slice(-4)}` : '';
  const cookiePath = path.join(rootDir, 'data/cookies.json');
  const isFbConnected = fs.existsSync(cookiePath) && JSON.parse(fs.readFileSync(cookiePath, 'utf-8')).length > 0;

  res.json({
    configured: !!rawKey,
    maskedKey,
    isFacebookConnected: isFbConnected || process.env.TEST_MODE === 'true',
    port: PORT,
    isSystemReady,
    recoveryStats,
    serverInstanceId: SERVER_INSTANCE_ID
  });
});

// Facebook Login Browser
app.post('/api/login/facebook', async (req, res) => {
  try {
    res.write(JSON.stringify({ status: 'opening', message: 'Đang mở trình duyệt đăng nhập Facebook...' }) + '\n');
    await launchLoginBrowser();
    res.write(JSON.stringify({ status: 'closed', message: 'Đã lưu phiên đăng nhập Facebook.' }) + '\n');
    res.end();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Poster Rule Extraction
app.post('/api/campaigns/extract-rules', upload.single('poster'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Vui lòng chọn 1 ảnh Poster.' });
    }
    const posterPath = req.file.path;
    const rules = await extractRulesFromPoster(posterPath);
    try { fs.unlinkSync(posterPath); } catch (e) {}
    res.json({ success: true, rules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create Campaign
app.post('/api/campaigns', (req, res) => {
  try {
    const { name, description, rules } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Thiếu tên chiến dịch.' });

    const campaignId = `camp_${Date.now()}`;
    const ruleId = `rule_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO campaigns (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(campaignId, name, description || '', now, now);

    db.prepare(`
      INSERT INTO campaign_rules (
        id, campaign_id, rule_version, name, product_names, required_hashtags, required_tags,
        min_video_duration_sec, min_livestream_duration_sec, require_cta, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId,
      campaignId,
      1,
      name,
      JSON.stringify(rules?.productNames || []),
      JSON.stringify(rules?.requiredHashtags || []),
      JSON.stringify(rules?.requiredTags || []),
      rules?.minVideoDurationSec || 30,
      rules?.minLivestreamDurationSec || 900,
      rules?.requireCTA ? 1 : 0,
      now
    );

    createAuditLog('USER', 'USER', 'CREATE_CAMPAIGN', 'CAMPAIGN', campaignId, null, { campaignId, ruleId, name });
    res.json({ success: true, campaignId, ruleId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Campaigns
app.get('/api/campaigns', (req, res) => {
  try {
    const campaigns = db.prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`).all();
    const result = campaigns.map(c => {
      const latestRule = db.prepare(`SELECT * FROM campaign_rules WHERE campaign_id = ? ORDER BY rule_version DESC LIMIT 1`).get(c.id);
      return { ...c, rule: latestRule };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Inspect Excel File
app.post('/api/excel/inspect', upload.single('excel'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng tải lên file Excel.' });

    const filePath = req.file.path;
    const fileHash = computeFileHash(filePath);
    const excelId = `excel_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO excel_files (id, original_name, file_path, file_hash, row_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(excelId, req.file.originalname, filePath, fileHash, 0, now);

    const inspection = await inspectExcelFile(filePath);

    res.json({
      success: true,
      excelFileId: excelId,
      sheets: inspection.sheets
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Confirm Excel Mapping
app.post('/api/excel/confirm-mapping', (req, res) => {
  try {
    const { excelFileId, mappingConfig } = req.body;
    if (!excelFileId || !mappingConfig) return res.status(400).json({ success: false, error: 'Thiếu dữ liệu mapping.' });

    const mappingId = `map_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO excel_mappings (id, excel_file_id, sheet_name, header_row, data_start_row, mapping_type, columns_json, sessions_json, confirmed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      mappingId,
      excelFileId,
      mappingConfig.sheets[0]?.sheetName || 'Sheet1',
      mappingConfig.sheets[0]?.headerRow || 1,
      mappingConfig.sheets[0]?.dataStartRow || 2,
      mappingConfig.sheets[0]?.mappingType || 'SINGLE_SESSION',
      JSON.stringify(mappingConfig.sheets[0]?.columnsMapping || {}),
      JSON.stringify(mappingConfig.sheets[0]?.sessions || []),
      now
    );

    res.json({ success: true, mappingId, mappingConfig });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create Job & Items in SQLite
app.post('/api/jobs', async (req, res) => {
  try {
    const { campaignId, excelFileId, mappingId, mappingConfig, config } = req.body;

    const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId);
    const rule = db.prepare(`SELECT * FROM campaign_rules WHERE campaign_id = ? ORDER BY rule_version DESC LIMIT 1`).get(campaignId);
    const excelFile = db.prepare(`SELECT * FROM excel_files WHERE id = ?`).get(excelFileId);

    if (!campaign || !rule || !excelFile) {
      return res.status(400).json({ success: false, error: 'Không tìm thấy thông tin chiến dịch hoặc file Excel.' });
    }

    const items = await extractItemsFromExcel(excelFile.file_path, mappingConfig);
    if (items.length === 0) {
      return res.status(400).json({ success: false, error: 'Không lọc được link bài viết nào từ file Excel.' });
    }

    const jobId = `job_${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO jobs (id, campaign_id, campaign_rule_id, excel_file_id, excel_mapping_id, status, total_items, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?)
    `).run(jobId, campaignId, rule.id, excelFileId, mappingId || 'map_default', items.length, JSON.stringify(config || {}), now, now);

    const insertItemStmt = db.prepare(`
      INSERT INTO job_items (
        id, job_id, workbook_id, sheet_name, source_row, session_key,
        source_url, normalized_url, platform, source_url_cell, target_cells_json,
        region, customer_code, customer_name, technical_status, attempt_count, max_attempts,
        idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 4, ?, ?, ?)
    `);

    const transaction = db.transaction((itemList) => {
      for (let i = 0; i < itemList.length; i++) {
        const item = itemList[i];
        const itemId = `item_${jobId}_${i + 1}`;
        const platform = (item.sourceUrl || '').includes('tiktok.com') ? 'TIKTOK' : 'FACEBOOK';
        const sessionKey = item.sessionKey || 'session_1';
        const idempotencyKey = crypto.createHash('sha256').update(`${jobId}_${item.sourceUrl}_${sessionKey}`).digest('hex');

        // Target cells JSON validation
        const targetCells = item.targetCells || {};

        insertItemStmt.run(
          itemId,
          jobId,
          excelFile.id,
          item.sheetName || 'Sheet1',
          item.sourceRow || (i + 2),
          sessionKey,
          item.sourceUrl,
          item.sourceUrl,
          platform,
          item.sourceUrlCell || null,
          JSON.stringify(targetCells),
          item.region || null,
          item.customerCode || null,
          item.customerName || null,
          idempotencyKey,
          now,
          now
        );
      }
    });

    transaction(items);
    createAuditLog('USER', 'USER', 'CREATE_JOB', 'JOB', jobId, null, { jobId, totalItems: items.length });
    createNotification('JOB_CREATED', 'INFO', 'Tạo Job mới thành công', `Job ${jobId} với ${items.length} bài nộp đã được khởi tạo.`, jobId);

    res.json({ success: true, jobId, totalItems: items.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start / Execute Job Worker
app.post('/api/jobs/:id/start', async (req, res) => {
  const jobId = req.params.id;
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Không tìm thấy Job.' });

  const nowStr = new Date().toISOString();
  db.prepare(`UPDATE jobs SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`).run(nowStr, nowStr, jobId);
  createAuditLog('USER', 'USER', 'START_JOB', 'JOB', jobId);

  res.json({ success: true, message: 'Đã khởi chạy Job.' });

  // Background Worker Loop using Atomic Lease & Retry Scheduler
  (async () => {
    const ruleRow = db.prepare(`SELECT * FROM campaign_rules WHERE id = ?`).get(job.campaign_rule_id);
    const ruleObj = {
      productNames: JSON.parse(ruleRow.product_names || '[]'),
      requiredHashtags: JSON.parse(ruleRow.required_hashtags || '[]'),
      requiredTags: JSON.parse(ruleRow.required_tags || '[]'),
      minVideoDurationSec: ruleRow.min_video_duration_sec,
      minLivestreamDurationSec: ruleRow.min_livestream_duration_sec,
      requireCTA: ruleRow.require_cta === 1
    };

    while (true) {
      // Check current job status (cancel / pause requested)
      const currentJob = db.prepare(`SELECT status, cancel_requested, pause_requested FROM jobs WHERE id = ?`).get(jobId);
      if (!currentJob || currentJob.status === 'CANCELLED' || currentJob.status === 'PAUSED') break;

      if (currentJob.cancel_requested === 1) {
        db.prepare(`UPDATE jobs SET status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), jobId);
        db.prepare(`UPDATE job_items SET technical_status = 'CANCELLED', updated_at = ? WHERE job_id = ? AND technical_status IN ('PENDING', 'RETRYING')`).run(new Date().toISOString(), jobId);
        createNotification('JOB_CANCELLED', 'WARNING', 'Job đã bị hủy', `Job ${jobId} đã dừng theo yêu cầu của người dùng.`, jobId);
        break;
      }
      if (currentJob.pause_requested === 1) {
        db.prepare(`UPDATE jobs SET status = 'PAUSED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), jobId);
        createNotification('JOB_PAUSED', 'INFO', 'Job đã tạm dừng', `Job ${jobId} đã tạm dừng. Có thể khôi phục bất kỳ lúc nào.`, jobId);
        break;
      }

      // Pick next item ready for processing
      const nowIso = new Date().toISOString();
      const nextItem = db.prepare(`
        SELECT * FROM job_items 
        WHERE job_id = ? 
          AND technical_status IN ('PENDING', 'RETRYING')
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY source_row ASC, id ASC
        LIMIT 1
      `).get(jobId, nowIso);

      if (!nextItem) break; // No remaining items

      // Atomic Lease acquisition
      const locked = acquireItemLock(nextItem.id, SERVER_INSTANCE_ID);
      if (!locked) continue; // Another process grabbed it or lock failed

      // Heartbeat timer during processing
      const heartbeatTimer = setInterval(() => {
        updateHeartbeat(nextItem.id, SERVER_INSTANCE_ID);
      }, 15000);

      try {
        let scrapeRes;
        if (process.env.TEST_MODE === 'true') {
          scrapeRes = {
            success: true,
            accessState: 'ACCESSIBLE',
            platform: nextItem.platform,
            postType: 'Video clip',
            durationSeconds: 45,
            captionText: 'Bài dự thi #10tyloikhuan #caovuottroi #giainhietmuahe #SmartaGrowOpti @HùngCườngCompany Mua ngay tại cửa hàng',
            likes: 120,
            comments: 15,
            shares: 2,
            views: 2500,
            proofScreen1: '/screenshots/mock.png',
            proofScreen2: '/screenshots/mock.png'
          };
        } else {
          scrapeRes = await scrapePost(nextItem.source_url, true, null);
        }

        const accessMapping = mapAccessStateToItemStatus(scrapeRes.accessState, nextItem.attempt_count + 1, nextItem.max_attempts || 4);

        if (accessMapping.shouldPauseJob) {
          // Access State requiring Pause (LOGIN_REQUIRED, SESSION_EXPIRED, CAPTCHA, CHECKPOINT)
          releaseItemLock(nextItem.id, accessMapping.technicalStatus, null, scrapeRes.accessState, `Tài khoản hoặc phiên truy cập bị khóa/xác minh: ${scrapeRes.accessState}`);
          db.prepare(`UPDATE jobs SET pause_requested = 1, status = 'PAUSED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), jobId);
          createNotification('JOB_SECURITY_PAUSE', 'ERROR', 'Tạm dừng Job do sự cố đăng nhập', `Phát hiện ${scrapeRes.accessState} tại dòng ${nextItem.source_row}. Job đã tạm dừng để tránh khóa tài khoản.`, jobId, nextItem.id);
          clearInterval(heartbeatTimer);
          break;
        }

        if (accessMapping.technicalStatus === 'RETRYING') {
          const delayMs = getRetryDelayMs(nextItem.attempt_count);
          releaseItemLock(nextItem.id, 'RETRYING', null, scrapeRes.accessState, `Gặp lỗi có thể thử lại (${scrapeRes.accessState}). Thử lại sau ${delayMs / 1000}s`, delayMs);
          clearInterval(heartbeatTimer);
          continue;
        }

        let aiRes = null;
        if (scrapeRes.success && scrapeRes.accessState === 'ACCESSIBLE') {
          try {
            aiRes = await analyzePost(scrapeRes.proof1Path, scrapeRes.captionText, ruleObj);
          } catch (aiErr) {
            console.error('[Worker] AI Analysis fallback:', aiErr.message);
          }
        }

        const evalResult = computeEvaluation(scrapeRes, ruleObj, aiRes);
        const evalNow = new Date().toISOString();

        // Save Scrape Result
        db.prepare(`
          INSERT OR REPLACE INTO scrape_results (id, job_item_id, access_state, post_type, duration_seconds, caption_text, likes, comments, shares, views, raw_metrics_json, extracted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `scrape_${nextItem.id}`,
          nextItem.id,
          scrapeRes.accessState,
          scrapeRes.postType || 'Video clip',
          scrapeRes.durationSeconds || null,
          scrapeRes.captionText || '',
          scrapeRes.likes !== undefined ? scrapeRes.likes : null,
          scrapeRes.comments !== undefined ? scrapeRes.comments : null,
          scrapeRes.shares !== undefined ? scrapeRes.shares : null,
          scrapeRes.views !== undefined ? scrapeRes.views : null,
          JSON.stringify(scrapeRes),
          evalNow
        );

        // Save Evaluation Result
        db.prepare(`
          INSERT OR REPLACE INTO evaluation_results (id, job_item_id, dk1_passed, dk1_reason, dk2_passed, dk2_reason, overall_result, confidence, feedback, evaluated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `eval_${nextItem.id}`,
          nextItem.id,
          evalResult.dk1.isStandard ? 1 : 0,
          evalResult.dk1.reason,
          evalResult.dk2.isStandard ? 1 : 0,
          evalResult.dk2.reason,
          evalResult.businessResult,
          evalResult.confidence,
          evalResult.feedback,
          evalNow
        );

        // Save Evidence Metadata with SHA-256 file hashes
        if (scrapeRes.proofScreen1) {
          const hash1 = computeFileHash(path.join(rootDir, 'public', scrapeRes.proofScreen1.replace(/^\//, '')));
          db.prepare(`
            INSERT OR REPLACE INTO evidence_files (id, job_id, job_item_id, platform, source_url, evidence_type, file_path, file_name, file_hash, captured_at, created_at)
            VALUES (?, ?, ?, ?, ?, 'CONTENT', ?, ?, ?, ?, ?)
          `).run(`ev1_${nextItem.id}`, jobId, nextItem.id, nextItem.platform, nextItem.source_url, scrapeRes.proofScreen1, path.basename(scrapeRes.proofScreen1), hash1, evalNow, evalNow);
        }
        if (scrapeRes.proofScreen2) {
          const hash2 = computeFileHash(path.join(rootDir, 'public', scrapeRes.proofScreen2.replace(/^\//, '')));
          db.prepare(`
            INSERT OR REPLACE INTO evidence_files (id, job_id, job_item_id, platform, source_url, evidence_type, file_path, file_name, file_hash, captured_at, created_at)
            VALUES (?, ?, ?, ?, ?, 'ENGAGEMENT', ?, ?, ?, ?, ?)
          `).run(`ev2_${nextItem.id}`, jobId, nextItem.id, nextItem.platform, nextItem.source_url, scrapeRes.proofScreen2, path.basename(scrapeRes.proofScreen2), hash2, evalNow, evalNow);
        }

        // Finalize Item Completion
        releaseItemLock(nextItem.id, 'COMPLETED', evalResult.businessResult, null, null);

      } catch (itemErr) {
        console.error(`[Worker] Error processing item ${nextItem.id}:`, itemErr);
        const currentAttempt = nextItem.attempt_count + 1;
        const maxAttempts = nextItem.max_attempts || 4;

        if (currentAttempt < maxAttempts) {
          const delayMs = getRetryDelayMs(currentAttempt);
          releaseItemLock(nextItem.id, 'RETRYING', null, 'PROCESSING_ERROR', itemErr.message, delayMs);
        } else {
          // Technical error -> technical_status = PROCESSING_ERROR, business_result = null
          releaseItemLock(nextItem.id, 'PROCESSING_ERROR', null, 'PROCESSING_ERROR', itemErr.message);
        }
      } finally {
        clearInterval(heartbeatTimer);
      }

      // Update Job Statistics
      const counts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN technical_status = 'COMPLETED' THEN 1 ELSE 0 END) as processed,
          SUM(CASE WHEN business_result = 'PASSED' THEN 1 ELSE 0 END) as passed,
          SUM(CASE WHEN business_result = 'FAILED' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN business_result = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) as review,
          SUM(CASE WHEN technical_status = 'PROCESSING_ERROR' THEN 1 ELSE 0 END) as error
        FROM job_items WHERE job_id = ?
      `).get(jobId);

      db.prepare(`
        UPDATE jobs 
        SET processed_items = ?, passed_items = ?, failed_items = ?, review_items = ?, error_items = ?, updated_at = ?
        WHERE id = ?
      `).run(counts.processed || 0, counts.passed || 0, counts.failed || 0, counts.review || 0, counts.error || 0, new Date().toISOString(), jobId);
    }

    // Check final job state after loop completes
    const finalJob = db.prepare(`SELECT status, total_items, processed_items FROM jobs WHERE id = ?`).get(jobId);
    if (finalJob && finalJob.status === 'RUNNING') {
      const remaining = db.prepare(`SELECT COUNT(*) as count FROM job_items WHERE job_id = ? AND technical_status IN ('PENDING', 'PROCESSING', 'RETRYING')`).get(jobId).count;
      if (remaining === 0) {
        db.prepare(`UPDATE jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), jobId);
        createNotification('JOB_COMPLETED', 'SUCCESS', 'Job hoàn thành', `Job ${jobId} đã xử lý xong toàn bộ ${finalJob.total_items} mục.`, jobId);
      }
    }
  })().catch(err => console.error('[Worker] Fatal error in job queue:', err));
});

// Get Job Status
app.get('/api/jobs/:id', (req, res) => {
  try {
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job không tồn tại.' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Job Items list
app.get('/api/jobs/:id/items', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT 
        i.*,
        s.access_state, s.post_type, s.duration_seconds, s.caption_text, s.likes, s.comments, s.shares, s.views,
        e.dk1_passed, e.dk1_reason, e.dk2_passed, e.dk2_reason, e.overall_result, e.confidence, e.feedback
      FROM job_items i
      LEFT JOIN scrape_results s ON i.id = s.job_item_id
      LEFT JOIN evaluation_results e ON i.id = e.job_item_id
      WHERE i.job_id = ?
      ORDER BY i.source_row ASC
    `).all(req.params.id);

    const result = items.map(item => {
      const evidences = db.prepare(`SELECT * FROM evidence_files WHERE job_item_id = ?`).all(item.id);
      const proof1 = evidences.find(ev => ev.evidence_type === 'CONTENT');
      const proof2 = evidences.find(ev => ev.evidence_type === 'ENGAGEMENT');

      return {
        ...item,
        proofScreen1: proof1 ? proof1.file_path : null,
        proofScreen2: proof2 ? proof2.file_path : null
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pause Job
app.post('/api/jobs/:id/pause', (req, res) => {
  db.prepare(`UPDATE jobs SET pause_requested = 1, status = 'PAUSED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
  createAuditLog('USER', 'USER', 'PAUSE_JOB', 'JOB', req.params.id);
  createNotification('JOB_PAUSED', 'INFO', 'Đã tạm dừng Job', `Job ${req.params.id} đã tạm dừng theo yêu cầu.`, req.params.id);
  res.json({ success: true, message: 'Đã tạm dừng Job.' });
});

// Resume Job
app.post('/api/jobs/:id/resume', (req, res) => {
  db.prepare(`UPDATE jobs SET pause_requested = 0, status = 'RUNNING', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
  createAuditLog('USER', 'USER', 'RESUME_JOB', 'JOB', req.params.id);
  createNotification('JOB_RESUMED', 'INFO', 'Đã tiếp tục Job', `Job ${req.params.id} đang tiếp tục xử lý các bài nộp còn lại.`, req.params.id);
  res.json({ success: true, message: 'Đang khôi phục chạy Job...' });
});

// Cancel Job
app.post('/api/jobs/:id/cancel', (req, res) => {
  db.prepare(`UPDATE jobs SET cancel_requested = 1, status = 'CANCELLED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
  db.prepare(`UPDATE job_items SET technical_status = 'CANCELLED', updated_at = ? WHERE job_id = ? AND technical_status IN ('PENDING', 'RETRYING')`).run(new Date().toISOString(), req.params.id);
  createAuditLog('USER', 'USER', 'CANCEL_JOB', 'JOB', req.params.id);
  createNotification('JOB_CANCELLED', 'WARNING', 'Đã hủy Job', `Job ${req.params.id} đã bị hủy.`, req.params.id);
  res.json({ success: true, message: 'Đã hủy Job.' });
});

// Manual Review Override Endpoint (Transactional)
app.put('/api/job-items/:id/review', (req, res) => {
  try {
    const { newResult, reason } = req.body;
    const itemId = req.params.id;

    if (!newResult || !reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Bắt buộc nhập lý do điều chỉnh (không được để trống).' });
    }

    const item = db.prepare(`SELECT * FROM job_items WHERE id = ?`).get(itemId);
    if (!item) return res.status(404).json({ success: false, error: 'Không tìm thấy mục đánh giá.' });

    const currentEval = db.prepare(`SELECT * FROM evaluation_results WHERE job_item_id = ?`).get(itemId);
    const prevResult = currentEval ? currentEval.overall_result : (item.business_result || 'NEEDS_REVIEW');
    const nowStr = new Date().toISOString();

    const overrideTransaction = db.transaction(() => {
      // 1. Record immutable manual review entry
      const reviewId = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      db.prepare(`
        INSERT INTO manual_reviews (
          id, job_item_id, original_evaluation_result_id, reviewer_user_id, actor_type,
          previous_result, new_result, reason, before_json, after_json, reviewed_at
        ) VALUES (?, ?, ?, 'USER', 'USER', ?, ?, ?, ?, ?, ?)
      `).run(
        reviewId,
        itemId,
        currentEval ? currentEval.id : null,
        prevResult,
        newResult,
        reason.trim(),
        JSON.stringify(currentEval || { business_result: prevResult }),
        JSON.stringify({ business_result: newResult, reason: reason.trim() }),
        nowStr
      );

      // 2. Update effective evaluation result
      if (currentEval) {
        db.prepare(`
          UPDATE evaluation_results 
          SET overall_result = ?, feedback = ?, evaluated_at = ?
          WHERE job_item_id = ?
        `).run(newResult, `Đã điều chỉnh thủ công: ${reason.trim()}`, nowStr, itemId);
      } else {
        db.prepare(`
          INSERT INTO evaluation_results (id, job_item_id, overall_result, feedback, evaluated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(`eval_${itemId}`, itemId, newResult, `Đã điều chỉnh thủ công: ${reason.trim()}`, nowStr);
      }

      // 3. Update job_item current business result
      db.prepare(`
        UPDATE job_items 
        SET business_result = ?, updated_at = ?
        WHERE id = ?
      `).run(newResult, nowStr, itemId);

      // 4. Audit Log
      createAuditLog('USER', 'USER', 'MANUAL_OVERRIDE', 'JOB_ITEM', itemId, { business_result: prevResult }, { business_result: newResult }, reason.trim());
    });

    overrideTransaction();
    res.json({ success: true, message: 'Đã cập nhật kết quả kiểm tra thủ công thành công.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Notifications Endpoints
app.get('/api/notifications', (req, res) => {
  try {
    const notifications = db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`).all();
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notifications/:id/read', (req, res) => {
  try {
    db.prepare(`UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export ZIP Package
app.post('/api/jobs/:id/export', async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Không tìm thấy Job.' });

    const excelFile = db.prepare(`SELECT * FROM excel_files WHERE id = ?`).get(job.excel_file_id);
    const mappingRow = db.prepare(`SELECT * FROM excel_mappings WHERE id = ?`).get(job.excel_mapping_id);

    const mappingConfig = {
      sheets: [{
        sheetName: mappingRow ? mappingRow.sheet_name : 'Sheet1',
        headerRow: mappingRow ? mappingRow.header_row : 1,
        mappingType: mappingRow ? mappingRow.mapping_type : 'SINGLE_SESSION',
        columnsMapping: mappingRow ? JSON.parse(mappingRow.columns_json || '{}') : {},
        sessions: mappingRow ? JSON.parse(mappingRow.sessions_json || '[]') : []
      }]
    };

    const items = db.prepare(`
      SELECT 
        i.*,
        e.dk1_passed, e.dk2_passed, e.overall_result as business_result, e.feedback,
        s.likes, s.comments, s.shares, s.views
      FROM job_items i
      LEFT JOIN evaluation_results e ON i.id = e.job_item_id
      LEFT JOIN scrape_results s ON i.id = s.job_item_id
      WHERE i.job_id = ?
    `).all(jobId);

    const exportFilename = `Bao_cao_tracking_${jobId}.xlsx`;
    const tempExportExcelPath = path.join(rootDir, 'public/exports', exportFilename);

    await writeResultsToOriginalExcel(excelFile.file_path, tempExportExcelPath, mappingConfig, items);

    const evidenceFiles = db.prepare(`
      SELECT e.* FROM evidence_files e
      JOIN job_items i ON e.job_item_id = i.id
      WHERE i.job_id = ?
    `).all(jobId);

    const zipFilename = `FBEval_Export_${jobId}.zip`;
    const zipOutputPath = path.join(rootDir, 'public/exports', zipFilename);

    await createExportPackageZip(tempExportExcelPath, evidenceFiles, zipOutputPath);

    createAuditLog('USER', 'USER', 'EXPORT_PACKAGE', 'JOB', jobId);

    res.json({
      success: true,
      downloadUrl: `/exports/${zipFilename}`,
      excelUrl: `/exports/${exportFilename}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SPA Catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(rootDir, 'frontend/dist/index.html'));
});

// Graceful Shutdown Handling
function handleGracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Performing graceful shutdown...`);
  try {
    // Release active locks held by this instance
    db.prepare(`
      UPDATE job_items 
      SET technical_status = 'PENDING', locked_by = NULL, locked_at = NULL, heartbeat_at = NULL 
      WHERE locked_by = ? AND technical_status = 'PROCESSING'
    `).run(SERVER_INSTANCE_ID);
    console.log('[Server] Active locks released safely.');
  } catch (err) {
    console.error('[Server] Failed to release locks during shutdown:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

// SPA Static Fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/screenshots') || req.path.startsWith('/exports')) {
    return next();
  }
  const indexPath = path.join(rootDir, 'frontend/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('FBEVAL ACTIVATION V2.1 Backend Server is Running.');
  }
});

// Global API Error Handler - Guarantees API responses are ALWAYS valid JSON
app.use((err, req, res, next) => {
  console.error('[Express Global Error]:', err.stack || err);
  if (req.path.startsWith('/api') || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Lỗi xử lý server (Internal Error).'
    });
  }
  res.status(500).send(`Server Error: ${err.message}`);
});

// Startup Initialization Sequence
app.listen(PORT, () => {
  console.log(`\n===============================================================`);
  console.log(`   FBEVAL BOT SERVER V2.1 — INSTANCE: ${SERVER_INSTANCE_ID}`);
  console.log(`===============================================================`);
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`Executing startup Job Recovery Service...`);

  try {
    recoveryStats = runJobRecovery(SERVER_INSTANCE_ID);
    isSystemReady = true;
    console.log(`[Startup] Job Recovery completed successfully. System is READY for traffic.`);
  } catch (err) {
    console.error(`[Startup] CRITICAL: Job Recovery failed on startup:`, err);
    isSystemReady = true; // Fallback ready
  }
});
