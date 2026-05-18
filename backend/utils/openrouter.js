// backend/utils/openrouter.js
// OpenRouter API client with automatic retry + free-model fallback chain

// ⚠️ IMPORTANT: Get a FREE OpenRouter API key at https://openrouter.ai
// 1. Sign up at https://openrouter.ai (free tier available)
// 2. Go to https://openrouter.ai/settings/integrations to get your API key
// 3. Add it to .env: OPENROUTER_API_KEY=REPLACED_SECRET-actual-key-here
// For now, using placeholder — this will cause 401 errors until you add a real key
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'REPLACED_SECRET';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Free models tried in order — if one is rate-limited, the next is tried
const FREE_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-120b:free',
  'z-ai/glm-4.5-air:free',
  'minimax/minimax-m2.5:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'openai/gpt-oss-20b:free',
  'deepseek/deepseek-v4-flash:free',
  'poolside/laguna-xs.2:free',
  'meta-llama/llama-3.2-3b-instruct:free'
];

const MAX_RETRIES = 3;   // retries per model before moving to next
const BASE_DELAY_MS = 3000; // base wait between retries (multiplied per retry)

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call one model, with up to MAX_RETRIES on 429.
 * Returns { ok: true, data } or { ok: false, retryAfter }
 */
async function tryModel({ model, max_tokens, system, messages }) {
  const chatMessages = [];
  if (system) chatMessages.push({ role: 'system', content: system });
  for (const msg of messages) chatMessages.push({ role: msg.role, content: msg.content });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[OpenRouter] Trying model=${model} attempt=${attempt}/${MAX_RETRIES}`);

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://devswarm.app',
        'X-Title': 'DevSwarm',
      },
      body: JSON.stringify({ model, max_tokens, messages: chatMessages }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      return { ok: true, text };
    }

    // Parse error body
    let errBody = {};
    try { errBody = await response.json(); } catch (_) {}

    if (response.status === 429) {
      // Honor the Retry-After hint from OpenRouter if present
      const retryAfter = errBody?.error?.metadata?.retry_after_seconds ?? attempt * (BASE_DELAY_MS / 1000);
      const waitMs = Math.ceil(retryAfter * 1000) + 500; // add small buffer
      console.warn(`[OpenRouter] 429 on ${model} — waiting ${waitMs}ms before retry ${attempt}/${MAX_RETRIES}`);

      if (attempt < MAX_RETRIES) {
        await sleep(waitMs);
        continue; // retry same model
      } else {
        // Exhausted retries for this model
        return { ok: false, status: 429, model };
      }
    }

    // Non-429 error — don't retry this model
    const msg = errBody?.error?.message ?? response.statusText;
    
    // Special handling for 401 (auth errors)
    if (response.status === 401) {
      const helpMsg = `
❌ OpenRouter Authentication Failed (401)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your API key is invalid or missing.

FIX: Get a FREE OpenRouter API key:
  1. Visit https://openrouter.ai
  2. Sign up (free tier available)
  3. Get your key at https://openrouter.ai/settings/integrations
  4. Add to backend/.env:
     OPENROUTER_API_KEY=REPLACED_SECRET-key-here
  5. Restart the backend

Error details: ${msg}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
      console.error(helpMsg);
      throw new Error(helpMsg);
    }
    
    throw new Error(`OpenRouter API error ${response.status}: ${msg}`);
  }
}

/**
 * Public API — same signature as the old createMessage.
 * Tries each free model in sequence until one succeeds.
 */
async function createMessage({ max_tokens = 1000, system, messages }) {
  for (const model of FREE_MODELS) {
    const result = await tryModel({ model, max_tokens, system, messages });

    if (result.ok) {
      console.log(`[OpenRouter] ✅ Success with model=${model}`);
      // Return Anthropic-compatible shape: { content: [{ text }] }
      return { content: [{ text: result.text }] };
    }

    // 429 exhausted for this model — try next
    console.warn(`[OpenRouter] ⚠️  All retries exhausted for ${model}, trying next model...`);
  }

  throw new Error(
    'All OpenRouter free models are currently rate-limited. ' +
    'Please wait a minute and try again, or add your own key at https://openrouter.ai/settings/integrations'
  );
}

module.exports = { createMessage, FREE_MODELS };
