import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import db from '../db/index.js';
import { PosterRuleSchema, AIAnalysisSchema, cleanAndParseJSON } from '../analyzer.js';

/**
 * AI Provider Gateway supporting 9Router API & Gemini fallback.
 */
export class AIProviderGateway {
  constructor() {
    this.provider = process.env.AI_PROVIDER || 'gemini';
    this.fallbackProvider = process.env.AI_FALLBACK_PROVIDER || 'gemini';
    this.nineRouterBaseUrl = process.env.NINE_ROUTER_BASE_URL || 'https://api.9router.com/v1';
    this.nineRouterApiKey = process.env.NINE_ROUTER_API_KEY || '';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
  }

  /**
   * Health check for AI Provider availability.
   */
  async healthCheck() {
    try {
      if (this.provider === '9router' && this.nineRouterApiKey) {
        const res = await fetch(`${this.nineRouterBaseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${this.nineRouterApiKey}` }
        });
        if (res.ok) return { status: 'ONLINE', provider: '9router' };
      }

      if (this.geminiApiKey) {
        return { status: 'ONLINE', provider: 'gemini' };
      }

      return { status: 'OFFLINE', provider: 'none', reason: 'Chưa cấu hình API Key' };
    } catch (err) {
      return { status: 'DEGRADED', provider: this.provider, error: err.message };
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
   * Executes AI Chat for the Web AI Assistant with controlled tool definitions.
   */
  async chat(userMessage, systemContext = '') {
    const startTime = Date.now();
    const prompt = `System Context: ${systemContext}\nUser Message: ${userMessage}`;
    
    try {
      let responseText = '';
      let usedProvider = this.provider;
      let usedModel = 'gemini-1.5-flash';

      if (this.provider === '9router' && this.nineRouterApiKey) {
        try {
          const res = await fetch(`${this.nineRouterBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.nineRouterApiKey}`
            },
            body: JSON.stringify({
              model: '9router/auto',
              messages: [
                { role: 'system', content: systemContext },
                { role: 'user', content: userMessage }
              ]
            })
          });
          const data = await res.json();
          if (data.choices && data.choices[0]) {
            responseText = data.choices[0].message.content;
            usedProvider = '9router';
            usedModel = data.model || '9router/auto';
          } else {
            throw new Error(data.error?.message || '9Router empty response');
          }
        } catch (routerErr) {
          console.warn('[9Router Fallback to Gemini]', routerErr.message);
          usedProvider = 'gemini';
        }
      }

      if (!responseText) {
        const key = this.geminiApiKey || process.env.GEMINI_API_KEY;
        if (!key) throw new Error('Chưa cấu hình API Key cho AI Provider.');

        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent([prompt]);
        responseText = result.response.text();
        usedProvider = 'gemini';
      }

      this.logAIRequest({
        provider: usedProvider,
        model: usedModel,
        taskType: 'CHAT',
        promptSummary: userMessage,
        responseJson: responseText,
        status: 'SUCCESS',
        latencyMs: Date.now() - startTime
      });

      return responseText;

    } catch (err) {
      this.logAIRequest({
        provider: this.provider,
        model: 'unknown',
        taskType: 'CHAT',
        promptSummary: userMessage,
        responseJson: { error: err.message },
        status: 'ERROR',
        latencyMs: Date.now() - startTime
      });
      throw err;
    }
  }
}

export const aiGateway = new AIProviderGateway();
