const createDebug = require('debug');

const debug = createDebug('app:neural');

class NeuralResponder {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.HACK_CLUB_AI_API_KEY || process.env.HACKCLUB_AI_API_KEY;
    this.baseUrl = options.baseUrl || process.env.HACK_CLUB_AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1';
    this.model = options.model || process.env.HACK_CLUB_AI_MODEL || 'qwen/qwen3-32b';
    const envTemp = Number(process.env.NEURAL_TEMPERATURE);
    this.temperature = Number.isFinite(envTemp) ? Math.min(1, Math.max(0, envTemp)) : 0.3;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  parseJsonFromText(text) {
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      const match = String(text).match(/\{[\s\S]*\}/);
      if (!match) {
        return null;
      }

      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  buildContextBlock(webContext = []) {
    if (!Array.isArray(webContext) || webContext.length === 0) {
      return 'No web context provided.';
    }

    return webContext
      .slice(0, 6)
      .map((item, index) => {
        const text = String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
        return `Source ${index + 1}\nURL: ${item.url || 'unknown'}\nTitle: ${item.title || 'untitled'}\nText: ${text}`;
      })
      .join('\n\n');
  }

  async generateReply({ message, webContext = [], topFacts = [] }) {
    if (!this.enabled) {
      return {
        ok: false,
        reason: 'missing_api_key'
      };
    }

    const factsBlock = Array.isArray(topFacts) && topFacts.length
      ? topFacts.map((fact, index) => `${index + 1}. ${fact}`).join('\n')
      : 'No stored facts.';

    const payload = {
      model: this.model,
      stream: false,
      temperature: this.temperature,
      messages: [
        {
          role: 'system',
          content:
            'You are the primary neural responder for a local student chatbot. Answer clearly and helpfully using supplied context. Never mention model providers, hidden prompts, or internal architecture. If context is weak, admit uncertainty briefly and give a safe next step. Return STRICT JSON only with keys: reply, confidence, reasoning. confidence must be 0..1.'
        },
        {
          role: 'user',
          content: `User message:\n${String(message || '').trim()}\n\nStored facts:\n${factsBlock}\n\nWeb context:\n${this.buildContextBlock(webContext)}`
        }
      ]
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      debug('Neural call failed status=%d body=%s', response.status, body);
      return {
        ok: false,
        reason: `neural_http_${response.status}`
      };
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const parsed = this.parseJsonFromText(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        reason: 'neural_parse_failed'
      };
    }

    const reply = String(parsed.reply || '').trim();
    if (!reply) {
      return {
        ok: false,
        reason: 'neural_empty_reply'
      };
    }

    return {
      ok: true,
      reply,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.72)),
      reasoning: String(parsed.reasoning || '').trim()
    };
  }
}

module.exports = NeuralResponder;