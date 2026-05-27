const { OpenAI } = require('openai');
const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { pool } = require('../database/pool');

// OpenAI client for chat
const openai = new OpenAI({
  apiKey: config.LLM_API,
  baseURL: config.LLM_ENDPOINT
});

// Google client for embeddings
const googleAi = new GoogleGenAI({ apiKey: config.GOOGLE_API });

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

async function logApiCall(apiName, model, inputTokens, outputTokens, latencyMs) {
  try {
    await pool.query(
      `INSERT INTO api_calls (user_id, api_name, model, input_tokens, output_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [config.ALLOWED_USER_ID, apiName, model, inputTokens, outputTokens, latencyMs]
    );
  } catch (err) {
    console.error('[API Log] Failed:', err.message);
  }
}

async function chatWithTools(history, tools = null) {
  const start = Date.now();
  
  const options = {
    model: config.LLM_MODEL,
    messages: history,
  };
  
  if (tools && tools.length > 0) {
    options.tools = tools;
  }

  const response = await openai.chat.completions.create(options);
  const message = response.choices[0].message;
  const latency = Date.now() - start;

  const inputText = JSON.stringify(history);
  const outputText = message.content || JSON.stringify(message.tool_calls);

  await logApiCall('llm_chat', config.LLM_MODEL, estimateTokens(inputText), estimateTokens(outputText), latency);

  // Return the entire message object for easier tool handling
  return message;
}

async function embedText(text) {
  const start = Date.now();
  const result = await googleAi.models.embedContent({
    model: config.EMBEDDING_MODEL,
    contents: text,
  });
  
  await logApiCall('gemini_embedding', config.EMBEDDING_MODEL, estimateTokens(text), 0, Date.now() - start);
  return result?.embeddings?.[0]?.values;
}

function getResponseText(message) {
  return message.content || '';
}

function getFunctionCalls(message) {
  return message.tool_calls || null;
}

module.exports = { chatWithTools, embedText, getResponseText, getFunctionCalls };