const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const DEFAULT_TOPICS = [
  'math-basics',
  'algebra',
  'geometry',
  'statistics',
  'physics',
  'chemistry',
  'biology',
  'computer-science',
  'programming',
  'algorithms',
  'data-literacy',
  'critical-thinking',
  'logic',
  'english-grammar',
  'writing',
  'reading-comprehension',
  'history',
  'economics',
  'health',
  'study-skills'
];

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message, meta) {
  const stamp = new Date().toISOString();
  if (meta && typeof meta === 'object') {
    console.log(`[${stamp}] [${level}] ${message} ${JSON.stringify(meta)}`);
    return;
  }
  console.log(`[${stamp}] [${level}] ${message}`);
}

function printSection(title, payload) {
  const line = '='.repeat(28);
  console.log(`\n${line} ${title} ${line}`);

  if (typeof payload === 'string') {
    console.log(payload);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  console.log(`${'='.repeat(28 + title.length + 29)}\n`);
}

function normalizeTopic(value) {
  const topic = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/\-+/g, '-')
    .replace(/^\-+|\-+$/g, '');

  return topic || 'general';
}

function parseTopics(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return [...DEFAULT_TOPICS];
  }

  const parsed = raw
    .split(',')
    .map((item) => normalizeTopic(item))
    .filter(Boolean);

  if (!parsed.length) {
    return [...DEFAULT_TOPICS];
  }

  return [...new Set(parsed)];
}

function normalizeContent(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeStableId({ topic, content, seed }) {
  const hash = crypto
    .createHash('sha1')
    .update(`${seed}|${topic}|${content}`)
    .digest('hex')
    .slice(0, 12);
  return `hc-${topic}-${hash}`;
}

function parseJsonArray(text) {
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = String(text).match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function sanitizeLessons(items, { seed }) {
  const output = [];
  const seenById = new Set();
  const seenByContent = new Set();

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const topic = normalizeTopic(item.topic);
    const content = normalizeContent(item.content);
    if (!content || content.length < 40) {
      continue;
    }

    const contentKey = crypto.createHash('sha1').update(`${topic}|${content}`).digest('hex');
    if (seenByContent.has(contentKey)) {
      continue;
    }

    let id = String(item.id || '').trim().toLowerCase();
    id = id.replace(/[^a-z0-9\-]/g, '-').replace(/\-+/g, '-').replace(/^\-+|\-+$/g, '');
    if (!id) {
      id = makeStableId({ topic, content, seed });
    }

    if (seenById.has(id)) {
      id = makeStableId({ topic, content, seed: `${seed}-${id}` });
    }

    seenById.add(id);
    seenByContent.add(contentKey);
    output.push({ id, topic, content });
  }

  return output;
}

function uniqueById(items) {
  const byId = new Map();
  for (const item of items) {
    if (!item || !item.id) {
      continue;
    }
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

async function callHackClubAI({ apiKey, baseUrl, model, topics, count, batchIndex }) {
  const selectedTopics = topics.slice(batchIndex % topics.length).concat(topics.slice(0, batchIndex % topics.length)).slice(0, 8);

  const payload = {
    model,
    stream: false,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content:
          'You are generating high-quality teaching lessons for a local chatbot memory system. Return STRICT JSON only as an array. Each array item must be an object with exactly keys: id, topic, content. content must be factual, concise, and at least 2 sentences. Keep topics broad and useful for long-term learning.'
      },
      {
        role: 'user',
        content: `Generate ${count} unique lessons. Cover these priority topics: ${selectedTopics.join(', ')}. Ensure the set is diverse across science, math, writing, technology, history, and practical reasoning. Output JSON array only.`
      }
    ]
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Hack Club AI failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsedLessons = parseJsonArray(text);

  printSection(`Hack Club AI Raw Response (Batch ${batchIndex + 1})`, text || '[empty response]');
  printSection(`Hack Club AI Parsed Lessons (Batch ${batchIndex + 1})`, parsedLessons);

  return parsedLessons;
}

async function generateLessons({
  apiKey,
  baseUrl,
  model,
  topics,
  batchCount,
  lessonsPerBatch,
  delayMs,
  maxRetries,
  seed
}) {
  const all = [];

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    let success = false;
    let lastError = null;

    log('info', `starting_batch`, {
      batch: batchIndex + 1,
      totalBatches: batchCount,
      lessonsPerBatch,
      topicWindowStart: batchIndex % topics.length
    });

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const generated = await callHackClubAI({
          apiKey,
          baseUrl,
          model,
          topics,
          count: lessonsPerBatch,
          batchIndex
        });

        const sanitized = sanitizeLessons(generated, {
          seed: `${seed}-b${batchIndex + 1}-a${attempt}`
        });

        all.push(...sanitized);
        success = true;
        log('info', 'batch_success', {
          batch: batchIndex + 1,
          totalBatches: batchCount,
          attempt,
          generated: generated.length,
          accepted: sanitized.length,
          accumulatedAccepted: all.length
        });
        break;
      } catch (error) {
        lastError = error;
        log('warn', 'batch_attempt_failed', {
          batch: batchIndex + 1,
          attempt,
          maxRetries,
          message: error.message
        });
        if (attempt < maxRetries) {
          await sleep(delayMs);
        }
      }
    }

    if (!success) {
      throw lastError || new Error(`Batch ${batchIndex + 1} failed`);
    }

    if (batchIndex < batchCount - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return uniqueById(all);
}

async function teachViaApi({ apiBaseUrl, lessons, chunkSize }) {
  let loadedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < lessons.length; index += chunkSize) {
    const chunk = lessons.slice(index, index + chunkSize);
    const chunkNumber = Math.floor(index / chunkSize) + 1;
    const totalChunks = Math.max(1, Math.ceil(lessons.length / chunkSize));

    printSection(`Lessons Sent To API (Chunk ${chunkNumber}/${totalChunks})`, chunk);

    const response = await fetch(`${apiBaseUrl}/api/learn/lesson`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ lessons: chunk })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API chunk failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    printSection(`API Response (Chunk ${chunkNumber}/${totalChunks})`, data);

    loadedCount += Number(data.loadedCount || 0);
    skippedCount += Number(data.skippedCount || 0);
  }

  return { loadedCount, skippedCount };
}

function teachViaFile({ filePath, lessons }) {
  let existing = [];
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    existing = Array.isArray(parsed) ? parsed : [];
  }

  const byId = new Map(existing.map((item) => [item.id, item]));
  let added = 0;

  for (const lesson of lessons) {
    if (!byId.has(lesson.id)) {
      byId.set(lesson.id, lesson);
      added += 1;
    }
  }

  const merged = [...byId.values()];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  return { added, total: merged.length };
}

async function main() {
  const mode = getArg('--mode', 'both');
  const apiBaseUrl = getArg('--api', 'http://localhost:3000');
  const outFile = path.resolve(getArg('--out', './data/starter-lessons.json'));
  const chunkSize = Number(getArg('--chunk', '40'));
  const topics = parseTopics(getArg('--topics', ''));

  const batchCount = Number(getArg('--batches', '25'));
  const lessonsPerBatch = Number(getArg('--per-batch', '24'));
  const delayMs = Number(getArg('--delay-ms', '700'));
  const maxRetries = Number(getArg('--retries', '3'));
  const model = getArg('--model', process.env.HACK_CLUB_AI_MODEL || 'qwen/qwen3-32b');
  const baseUrl = getArg('--base-url', process.env.HACK_CLUB_AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1');
  const apiKey =
    getArg('--key', process.env.HACK_CLUB_AI_API_KEY || process.env.HACKCLUB_AI_API_KEY || 'sk-hc-v1-cd365b5e1e68468d8f789bd1f0c99bfda120e68030a44fd3ab4214864361a165');

  if (!apiKey) {
    throw new Error(
      'Missing Hack Club AI key. Set HACK_CLUB_AI_API_KEY (or pass --key <token>) and try again.'
    );
  }

  const seed = `${Date.now()}`;

  log('info', 'generation_start', {
    mode,
    model,
    baseUrl,
    apiBaseUrl,
    outFile,
    chunkSize,
    batchCount,
    lessonsPerBatch,
    target: batchCount * lessonsPerBatch,
    delayMs,
    maxRetries,
    topicsCount: topics.length,
    topics
  });

  const lessons = await generateLessons({
    apiKey,
    baseUrl,
    model,
    topics,
    batchCount,
    lessonsPerBatch,
    delayMs,
    maxRetries,
    seed
  });

  log('info', 'generation_complete', {
    uniqueLessons: lessons.length
  });

  if (mode === 'api' || mode === 'both') {
    const apiResult = await teachViaApi({ apiBaseUrl, lessons, chunkSize });
    log('info', 'api_teaching_complete', {
      loaded: apiResult.loadedCount,
      skipped: apiResult.skippedCount
    });
  }

  if (mode === 'file' || mode === 'both') {
    const fileResult = teachViaFile({ filePath: outFile, lessons });
    log('info', 'file_teaching_complete', {
      added: fileResult.added,
      totalLessonsInFile: fileResult.total,
      file: outFile
    });
  }
}

main().catch((error) => {
  log('error', 'teach_hackclub_bulk_failed', {
    message: error.message || String(error)
  });
  process.exit(1);
});
