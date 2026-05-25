const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { pool } = require('../database/pool');

const ai = new GoogleGenAI({ apiKey: config.GOOGLE_API });

// Rough token estimator for cost logging
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Fire-and-forget API call logger
async function logApiCall(apiName, model, inputTokens, outputTokens, latencyMs) {
  try {
    await pool.query(
      `INSERT INTO api_calls (user_id, api_name, model, input_tokens, output_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [config.ALLOWED_USER_ID, apiName, model, inputTokens, outputTokens, latencyMs]
    );
  } catch (err) {
    console.error('[Gemini] Failed to log API call:', err.message);
  }
}

// Convert our internal history format to the new SDK format
function convertHistory(history) {
  return history.map(h => ({
    role: h.role,
    parts: h.parts,
  }));
}

// ONE call at a time. No concurrency.
async function chatWithTools(history, tools = null) {
  const start = Date.now();

  const result = await ai.models.generateContent({
    model: config.LLM_MODEL,
    contents: convertHistory(history),
    tools: tools ? [{ functionDeclarations: tools }] : undefined,
  });

  const latency = Date.now() - start;

  const inputText = history.map(h => h.parts?.map(p => p.text).join('') || '').join('');
  const outputText = result.text || '';

  await logApiCall(
    'gemini_chat',
    config.LLM_MODEL,
    estimateTokens(inputText),
    estimateTokens(outputText),
    latency
  );

  return result;
}

async function embedText(text) {
  const start = Date.now();

  const result = await ai.models.embedContent({
    model: config.EMBEDDING_MODEL,
    contents: text,
  });

  const latency = Date.now() - start;

  await logApiCall(
    'gemini_embedding',
    config.EMBEDDING_MODEL,
    estimateTokens(text),
    0,
    latency
  );

  // New SDK returns embeddings in a nested structure
  const values = result?.embeddings?.[0]?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error('Unexpected embedding response structure');
  }
  return values;
}

// Safe text extraction (new SDK uses .text property directly)
function getResponseText(response) {
  return response?.text || '';
}

// Safe function call extraction
function getFunctionCalls(response) {
  return response?.functionCalls || null;
}

module.exports = {
  chatWithTools,
  embedText,
  getResponseText,
  getFunctionCalls,
};