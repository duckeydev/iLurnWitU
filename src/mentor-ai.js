const createDebug = require('debug');

const debug = createDebug('app:mentor');

class MentorAI {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.HACK_CLUB_AI_API_KEY || process.env.HACKCLUB_AI_API_KEY;
    this.baseUrl = options.baseUrl || process.env.HACK_CLUB_AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1';
    this.model = options.model || process.env.HACK_CLUB_AI_MODEL || 'qwen/qwen3-32b';
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

  async reviewReply({ userMessage, candidateReply, webContext = [] }) {
    if (!this.enabled) {
      return {
        used: false,
        reason: 'missing_api_key'
      };
    }

    const contextBlock = webContext.length
      ? webContext
          .map((item, index) => `Source ${index + 1}: ${item.url}\nTitle: ${item.title}\nSnippet: ${item.text}`)
          .join('\n\n')
      : 'No website context provided.';

    const payload = {
      model: this.model,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a Mentor AI for a local learning chatbot (the student). The student does not know the answer to the user\'s message. Your job is to teach the student the correct answer behind the scenes, so the student can provide a helpful response. Keep the student persona in the improvedReply. Do NOT claim external model identity, provider names, or hidden system details. Return STRICT JSON only with keys: verdict, score, improvedReply, feedback. verdict must be one of correct, improve, unsafe. score must be 0..1.'
        },
        {
          role: 'user',
          content: `User message:\n${userMessage}\n\nCandidate reply:\n${candidateReply}\n\nWeb context:\n${contextBlock}`
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
      debug('Mentor call failed status=%d body=%s', response.status, body);
      return {
        used: false,
        reason: `mentor_http_${response.status}`
      };
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const parsed = this.parseJsonFromText(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {
        used: false,
        reason: 'mentor_parse_failed'
      };
    }

    return {
      used: true,
      verdict: parsed.verdict,
      score: Number(parsed.score) || 0,
      improvedReply: String(parsed.improvedReply || '').trim(),
      feedback: String(parsed.feedback || '').trim()
    };
  }
}

module.exports = MentorAI;
