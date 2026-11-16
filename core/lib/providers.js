// Fornecedores de IA com uma interface comum.
//   anthropic — API da Anthropic (Claude)
//   openai    — qualquer API compatível com OpenAI: OpenAI, OpenRouter, Gemini
//               (endpoint compatível), Mistral, Groq, Ollama/LM Studio locais…
//
// Mensagens normalizadas:
//   { role: 'user', text }
//   { role: 'assistant', text, toolCalls: [{ id, name, input }] }
//   { role: 'tool', results: [{ id, content }] }
import Anthropic from '@anthropic-ai/sdk';

export const PRESETS = {
  anthropic: { label: 'Anthropic (Claude)', provider: 'anthropic', baseURL: '', model: 'claude-sonnet-5-5' },
  groq: { label: 'Groq (plano grátis disponível)', provider: 'openai', baseURL: 'https://api.groq.com/openai/v1', model: '' },
  openai: { label: 'OpenAI', provider: 'openai', baseURL: 'https://api.openai.com/v1', model: '' },
  openrouter: { label: 'OpenRouter', provider: 'openai', baseURL: 'https://openrouter.ai/api/v1', model: '' },
  gemini: { label: 'Google Gemini (compatível OpenAI)', provider: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '' },
  ollama: { label: 'Ollama (local)', provider: 'openai', baseURL: 'http://localhost:11434/v1', model: '' },
  custom: { label: 'Outro compatível com OpenAI', provider: 'openai', baseURL: '', model: '' },
};

const isLocal = (url = '') => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);

export function isUsable(cfg) {
  if (!cfg?.provider || !cfg.model && cfg.provider !== 'anthropic') return false;
  if (cfg.provider === 'anthropic') return Boolean(cfg.apiKey);
  return Boolean(cfg.baseURL) && (Boolean(cfg.apiKey) || isLocal(cfg.baseURL));
}

export function makeProvider(cfg) {
  if (cfg.provider === 'anthropic') return anthropicProvider(cfg);
  if (cfg.provider === 'openai') return openaiProvider(cfg);
  throw new Error(`Fornecedor desconhecido: ${cfg.provider}`);
}

// ---------- Anthropic ----------
function anthropicProvider(cfg) {
  const client = new Anthropic({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });
  const model = cfg.model || PRESETS.anthropic.model;
  const toApi = (messages) => messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'assistant') return {
      role: 'assistant',
      content: [
        ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ...(m.toolCalls || []).map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
      ],
    };
    return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) };
  });
  return {
    model,
    async chat({ system, messages, tools, maxTokens = 2000 }) {
      const r = await client.messages.create({
        model, max_tokens: maxTokens, system, messages: toApi(messages),
        ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      });
      return {
        text: r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        toolCalls: r.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input })),
      };
    },
  };
}

// ---------- compatível com OpenAI (fetch, sem SDK) ----------
function openaiProvider(cfg) {
  const base = cfg.baseURL.replace(/\/$/, '');
  const toApi = (system, messages) => [
    { role: 'system', content: system },
    ...messages.flatMap((m) => {
      if (m.role === 'user') return [{ role: 'user', content: m.text }];
      if (m.role === 'assistant') return [{
        role: 'assistant', content: m.text || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input) } })) } : {}),
      }];
      return m.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content }));
    }),
  ];
  return {
    model: cfg.model,
    async chat({ system, messages, tools, maxTokens = 2000 }) {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model, max_tokens: maxTokens, messages: toApi(system, messages),
          ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
      const msg = data.choices?.[0]?.message || {};
      return {
        text: typeof msg.content === 'string' ? msg.content : (msg.content || []).map((p) => p.text || '').join(''),
        toolCalls: (msg.tool_calls || []).map((t) => ({ id: t.id, name: t.function.name, input: safeJson(t.function.arguments) })),
      };
    },
  };
}
function safeJson(s) { try { return typeof s === 'string' ? JSON.parse(s || '{}') : s || {}; } catch { return {}; } }
