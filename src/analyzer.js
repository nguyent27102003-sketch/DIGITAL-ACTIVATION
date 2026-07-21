import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/**
 * Zod Schema for AI Poster Rule Extraction
 */
export const PosterRuleSchema = z.object({
  campaignName: z.string().default('Chương Trình Truyền Thông'),
  productNames: z.array(z.string()).default([]),
  requiredHashtags: z.array(z.string()).default([]),
  requiredTags: z.array(z.union([
    z.string(),
    z.object({
      displayName: z.string(),
      acceptedPageUrls: z.array(z.string()).optional(),
      required: z.boolean().optional()
    })
  ])).default([]),
  minVideoDurationSec: z.number().default(30),
  minLivestreamDurationSec: z.number().default(900),
  requireCTA: z.boolean().default(true),
  summaryRules: z.string().optional()
});

/**
 * Zod Schema for AI Post Caption & Vision Analysis Response
 */
export const AIAnalysisSchema = z.object({
  postType: z.enum(['Livestream', 'Video clip', 'Unknown']).default('Video clip'),
  captionAnalysis: z.object({
    captionDetected: z.boolean().default(true),
    captionText: z.string().nullable().optional(),
    productMatched: z.boolean().default(true),
    productMatchReason: z.string().optional(),
    hasCTA: z.boolean().default(true),
    ctaText: z.string().nullable().optional()
  }).default({}),
  dk2: z.object({
    isStandard: z.boolean().default(true),
    missingHashtags: z.array(z.string()).default([]),
    matchedHashtags: z.array(z.string()).default([]),
    missingTags: z.array(z.string()).default([]),
    matchedTags: z.array(z.string()).default([]),
    hasCTA: z.boolean().default(true),
    productMatched: z.boolean().default(true),
    reason: z.string().default('Đạt')
  }).default({}),
  confidence: z.number().default(0.95),
  needsManualReview: z.boolean().default(false),
  reviewReasons: z.array(z.string()).default([])
});

export function cleanAndParseJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Dữ liệu AI phản hồi rỗng.');
  }

  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // 1. Try standard JSON parse first
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    // 2. Character scanner to escape unescaped control characters inside string literals only
    try {
      let inString = false;
      let sanitized = '';
      for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i];
        if (char === '"' && (i === 0 || cleaned[i - 1] !== '\\')) {
          inString = !inString;
          sanitized += char;
        } else if (inString && char === '\n') {
          sanitized += '\\n';
        } else if (inString && char === '\r') {
          sanitized += '\\r';
        } else if (inString && char === '\t') {
          sanitized += '\\t';
        } else {
          sanitized += char;
        }
      }
      return JSON.parse(sanitized);
    } catch (secondErr) {
      throw new Error(`Không thể parse phản hồi từ AI thành JSON: ${firstErr.message}`);
    }
  }
}

function getAIModel(apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY.');
  }
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType
    }
  };
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpeg' || ext === '.jpg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

import { aiGateway } from './ai/gateway.js';

export async function extractRulesFromPoster(posterImagePath, apiKey) {
  const prompt = `Bạn là chuyên gia phân tích thể lệ chương trình truyền thông / Trade Activation.
Hãy đọc kỹ hình ảnh Poster thể lệ này và trả về đúng 1 JSON Object tuân thủ schema:
{
  "campaignName": "Tên chương trình",
  "productNames": ["Tên các dòng sản phẩm liên quan"],
  "requiredHashtags": ["#Hashtag1", "#Hashtag2"],
  "requiredTags": ["@Page1"],
  "minVideoDurationSec": 30,
  "minLivestreamDurationSec": 900,
  "requireCTA": true,
  "summaryRules": "Tóm tắt thể lệ"
}`;

  const responseText = await aiGateway.generateVisionContent({
    prompt,
    imagePath: posterImagePath,
    overrideKey: apiKey
  });

  const jsonRaw = cleanAndParseJSON(responseText);
  return PosterRuleSchema.parse(jsonRaw);
}

export async function analyzePost(screenshotPath, extractedText, rule, apiKey) {
  const serializedRules = typeof rule === 'object' ? JSON.stringify(rule, null, 2) : String(rule);

  const prompt = `Bạn là trợ lý AI phân tích nội dung bài viết Facebook/TikTok.
CẤU HÌNH THỂ LỆ BẮT BUỘC:
${serializedRules}

NỘI DUNG VĂN BẢN CÀO TỪ BÀI VIẾT:
"${extractedText || ''}"

Hãy phân tích và trả về đúng JSON Object:
{
  "postType": "Livestream" hoặc "Video clip" hoặc "Unknown",
  "captionAnalysis": {
    "captionDetected": true,
    "captionText": "nội dung caption",
    "productMatched": true,
    "productMatchReason": "lý do match sản phẩm",
    "hasCTA": true,
    "ctaText": "lý do CTA"
  },
  "dk2": {
    "isStandard": true/false,
    "missingHashtags": [],
    "matchedHashtags": [],
    "missingTags": [],
    "matchedTags": [],
    "hasCTA": true/false,
    "productMatched": true/false,
    "reason": "nhận xét ĐK2"
  },
  "confidence": 0.95,
  "needsManualReview": false,
  "reviewReasons": []
}`;

  const responseText = await aiGateway.generateVisionContent({
    prompt,
    imagePath: screenshotPath,
    overrideKey: apiKey
  });

  const jsonRaw = cleanAndParseJSON(responseText);
  return AIAnalysisSchema.parse(jsonRaw);
}
