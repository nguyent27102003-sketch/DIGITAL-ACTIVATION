import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../db/index.js';
import { cleanAndParseJSON } from '../analyzer.js';

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpeg' || ext === '.jpg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function imageToBase64DataUrl(filePath) {
  const mime = getMimeType(filePath);
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

/**
 * Universal AI Provider Gateway supporting:
 * 1. Google Gemini (Native SDK)
 * 2. OpenAI / ChatGPT (Vision API)
 * 3. 9Router Multi-Model Gateway
 */
export class AIProviderGateway {
  constructor() {
    this.reloadConfig();
  }

  reloadConfig() {
    this.provider = process.env.AI_PROVIDER || 'gemini';
    this.fallbackProvider = process.env.AI_FALLBACK_PROVIDER || 'gemini';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.nineRouterApiKey = process.env.NINE_ROUTER_API_KEY || process.env.NINEROUTER_API_KEY || '';
    this.nineRouterBaseUrl = (process.env.NINE_ROUTER_BASE_URL || 'https://api.9router.com/v1').replace(/\/+$/, '');
  }

  /**
   * Health check for configured AI providers.
   */
  async healthCheck(customConfig = null) {
    const provider = customConfig?.provider || this.provider;
    const geminiKey = customConfig?.geminiApiKey || this.geminiApiKey;
    const openaiKey = customConfig?.openaiApiKey || this.openaiApiKey;
    const routerKey = customConfig?.nineRouterApiKey || this.nineRouterApiKey;
    const routerBaseUrl = (customConfig?.nineRouterBaseUrl || this.nineRouterBaseUrl).replace(/\/+$/, '');

    try {
      if (provider === '9router') {
        if (!routerKey) return { status: 'OFFLINE', provider: '9router', reason: 'Chưa nhập 9Router API Key' };
        const res = await fetch(`${routerBaseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${routerKey}` }
        });
        if (res.ok) return { status: 'ONLINE', provider: '9router', message: 'Kết nối 9Router Gateway thành công!' };
        const errText = await res.text();
        return { status: 'OFFLINE', provider: '9router', reason: `9Router phản hồi lỗi (${res.status}): ${errText.substring(0, 100)}` };
      }

      if (provider === 'openai') {
        if (!openaiKey) return { status: 'OFFLINE', provider: 'openai', reason: 'Chưa nhập ChatGPT / OpenAI API Key' };
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${openaiKey}` }
        });
        if (res.ok) return { status: 'ONLINE', provider: 'openai', message: 'Kết nối ChatGPT / OpenAI thành công!' };
        const errText = await res.text();
        return { status: 'OFFLINE', provider: 'openai', reason: `OpenAI phản hồi lỗi (${res.status}): ${errText.substring(0, 100)}` };
      }

      // Default: Gemini
      if (!geminiKey) return { status: 'OFFLINE', provider: 'gemini', reason: 'Chưa nhập Google Gemini API Key' };
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      await model.generateContent(['Hello']);
      return { status: 'ONLINE', provider: 'gemini', message: 'Kết nối Google Gemini AI thành công!' };

    } catch (err) {
      return { status: 'DEGRADED', provider, reason: err.message };
    }
  }

  /**
   * Logs AI requests into SQLite `ai_requests` table for full audit compliance.
   */
  logAIRequest({ provider, model, taskType, promptSummary, responseJson, status, latencyMs }) {
    try {
      const id = `air_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const inputHash = crypto.createHash('sha256').update(promptSummary || '').digest('hex').substring(0, 16);

      db.prepare(`
        INSERT INTO ai_requests 
        (id, provider, model, task_type, input_hash, prompt_summary, response_json, status, latency_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        provider,
        model,
        taskType,
        inputHash,
        (promptSummary || '').substring(0, 500),
        typeof responseJson === 'string' ? responseJson.substring(0, 1000) : JSON.stringify(responseJson).substring(0, 1000),
        status,
        latencyMs,
        new Date().toISOString()
      );
    } catch (err) {
      console.error('[AI Audit Log Error]', err);
    }
  }

  /**
   * Executes Vision + Text AI Analysis with fallback across 9Router, OpenAI, and Gemini.
   */
  async generateVisionContent({ prompt, imagePath, overrideKey = null, overrideProvider = null }) {
    this.reloadConfig();
    const startTime = Date.now();
    const activeProvider = overrideProvider || this.provider;

    let resultText = null;
    let usedProvider = activeProvider;
    let usedModel = 'unknown';

    // 1. Try 9Router Gateway
    if (activeProvider === '9router') {
      const apiKey = overrideKey || this.nineRouterApiKey;
      if (apiKey) {
        try {
          const content = [{ type: 'text', text: prompt }];
          if (imagePath && fs.existsSync(imagePath)) {
            content.push({ type: 'image_url', image_url: { url: imageToBase64DataUrl(imagePath) } });
          }

          const res = await fetch(`${this.nineRouterBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: '9router/auto',
              messages: [{ role: 'user', content }]
            })
          });
          const data = await res.json();
          if (data.choices && data.choices[0]?.message?.content) {
            resultText = data.choices[0].message.content;
            usedProvider = '9router';
            usedModel = data.model || '9router/auto';
          } else if (data.error) {
            throw new Error(data.error.message || 'Lỗi 9Router Gateway');
          }
        } catch (routerErr) {
          console.warn('[9Router Fallback Triggered]:', routerErr.message);
        }
      }
    }

    // 2. Try OpenAI / ChatGPT
    if (!resultText && (activeProvider === 'openai' || activeProvider === 'chatgpt')) {
      const apiKey = overrideKey || this.openaiApiKey;
      if (apiKey) {
        try {
          const content = [{ type: 'text', text: prompt }];
          if (imagePath && fs.existsSync(imagePath)) {
            content.push({ type: 'image_url', image_url: { url: imageToBase64DataUrl(imagePath) } });
          }

          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content }],
              response_format: { type: 'json_object' }
            })
          });
          const data = await res.json();
          if (data.choices && data.choices[0]?.message?.content) {
            resultText = data.choices[0].message.content;
            usedProvider = 'openai';
            usedModel = 'gpt-4o-mini';
          } else if (data.error) {
            throw new Error(data.error.message || 'Lỗi ChatGPT/OpenAI API');
          }
        } catch (openaiErr) {
          console.warn('[OpenAI Fallback Triggered]:', openaiErr.message);
        }
      }
    }

    // 3. Fallback to Google Gemini
    if (!resultText) {
      const apiKey = overrideKey || this.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Chưa cấu hình API Key hợp lệ cho bất kỳ AI Provider nào (Gemini / ChatGPT / 9Router). Vui lòng vào Cài Đặt để nhập API Key.');
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const parts = [prompt];
      if (imagePath && fs.existsSync(imagePath)) {
        parts.unshift({
          inlineData: {
            data: Buffer.from(fs.readFileSync(imagePath)).toString('base64'),
            mimeType: getMimeType(imagePath)
          }
        });
      }
      const res = await model.generateContent(parts);
      resultText = res.response.text();
      usedProvider = 'gemini';
      usedModel = 'gemini-1.5-flash';
    }

    this.logAIRequest({
      provider: usedProvider,
      model: usedModel,
      taskType: imagePath ? 'VISION_ANALYSIS' : 'TEXT_ANALYSIS',
      promptSummary: prompt,
      responseJson: resultText,
      status: 'SUCCESS',
      latencyMs: Date.now() - startTime
    });

    return resultText;
  }

  /**
   * Executes AI Chat Assistant.
   */
  async chat(userMessage, systemContext = '') {
    this.reloadConfig();
    const prompt = `System Context: ${systemContext}\nUser Message: ${userMessage}`;
    return this.generateVisionContent({ prompt });
  }
}

export const aiGateway = new AIProviderGateway();
