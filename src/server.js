const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const createDebug = require('debug');

require('dotenv').config();

const logger = require('./logger');
const LearningStore = require('./store');
const ChatbotBrain = require('./brain');
const WebLearner = require('./web-learner');
const MentorAI = require('./mentor-ai');
const NeuralResponder = require('./neural-responder');

const debug = createDebug('app:server');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs
      },
      'request_complete'
    );
  });
  next();
});

const store = new LearningStore(path.join(__dirname, '..', 'data', 'memory.json'));
const brain = new ChatbotBrain(store);
const webLearner = new WebLearner({
  apiKey: process.env.HACK_CLUB_AI_API_KEY,
  baseUrl: process.env.HACK_CLUB_AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1'
});
const mentorAI = new MentorAI();
const neuralResponder = new NeuralResponder();
const memoryFilePath = path.join(__dirname, '..', 'data', 'memory.json');
const neuralImportJobs = new Map();
let activeNeuralImportJobId = null;

function startNeuralImportJob() {
  if (activeNeuralImportJobId && neuralImportJobs.has(activeNeuralImportJobId)) {
    const existing = neuralImportJobs.get(activeNeuralImportJobId);
    if (existing && existing.status === 'running') {
      return existing;
    }
  }

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: {
      consideredSamples: 0,
      importedSamples: 0,
      trainedSamples: 0,
      neuralPrototypes: 0,
      done: false
    },
    result: null,
    error: null
  };

  neuralImportJobs.set(jobId, job);
  activeNeuralImportJobId = jobId;

  setImmediate(async () => {
    try {
      const result = await brain.importAllMemoryToNeuralAsync({
        onProgress: (progress) => {
          job.progress = {
            ...job.progress,
            ...progress
          };
        }
      });

      store.scheduleSave(['neural']);
      job.result = result;
      job.status = 'done';
      job.progress = {
        ...job.progress,
        done: true
      };
      job.finishedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || error || 'unknown_error');
      job.finishedAt = new Date().toISOString();
    } finally {
      if (activeNeuralImportJobId === jobId) {
        activeNeuralImportJobId = null;
      }
    }
  });

  return job;
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

const mentorDefaultEnabled = parseBooleanEnv(process.env.MENTOR_ENABLED, true);
const webSearchDefaultEnabled = parseBooleanEnv(process.env.WEB_SEARCH_ENABLED, true);
const neuralPrimaryDefaultEnabled = parseBooleanEnv(process.env.NEURAL_PRIMARY_ENABLED, true);
const neuralImportOnStartDefaultEnabled = parseBooleanEnv(process.env.NEURAL_IMPORT_ON_START, false);
const noOutsideAiDefaultEnabled = parseBooleanEnv(process.env.NO_OUTSIDE_AI_MODE, false);

function isModelIdentityQuestion(message) {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(what|which).*(llm|model|ai model)|what are you based on|who made you|who built you|what ai are you|what model are you/.test(
    normalized
  );
}

function shouldUseAutoWebSearch(message) {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(what is|whats|what's|what are|who is|tell me about|learn about|explain|define|how does|search|look up|deep research)/.test(normalized);
}

function shouldUseFastLocalPath(message) {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 6) {
    return false;
  }

  if (/[?]/.test(normalized)) {
    return false;
  }

  if (/(https?:\/\/|www\.)/.test(normalized)) {
    return false;
  }

  return /^(hi|hello|hey|yo|sup|hola|good morning|good afternoon|good evening|thanks|thank you|ok|okay|cool|nice)$/.test(
    normalized
  );
}

function violatesStudentVoice(text) {
  const sample = String(text || '').toLowerCase();
  if (!sample.trim()) {
    return true;
  }

  const blockedPatterns = [
    /\bi am based on\b/,
    /\bqwen\b/,
    /\bopenai\b/,
    /\bdeveloped by\b/,
    /\btongyi\b/,
    /\bmy model is\b/,
    /\bi am gpt\b/
  ];

  return blockedPatterns.some((pattern) => pattern.test(sample));
}

function buildReasoningSummary({ baseResult, mentorReview, webContexts, webFailures }) {
  const source = baseResult.debug.source;
  const confidence = Number(baseResult.debug.confidence || 0).toFixed(2);

  let text = `I chose the ${source} strategy with confidence ${confidence}.`;

  if (webContexts.length) {
    text += ` I used ${webContexts.length} source(s) from URLs or documents.`;
  }
  if (webFailures.length) {
    text += ` I skipped ${webFailures.length} source(s) because they could not be parsed.`;
  }

  if (mentorReview.used) {
    text += ` Mentor review says ${mentorReview.verdict || 'unknown'} with score ${Number(
      mentorReview.score || 0
    ).toFixed(2)}.`;
  } else {
    text += ` Mentor review was skipped (${mentorReview.reason || 'not_enabled'}).`;
  }

  return text;
}

function countResponseTokens(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function cosineSimilarityVectors(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = Number(a[index]) || 0;
    const bv = Number(b[index]) || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function resolveMemoryLineReference(memoryRef) {
  if (!memoryRef || !memoryRef.at) {
    return null;
  }

  try {
    const raw = await fs.promises.readFile(memoryFilePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    const atNeedle = `"at": "${memoryRef.at}"`;
    const userNeedle = memoryRef.user ? `"user": "${String(memoryRef.user).replace(/"/g, '\\"')}` : null;

    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(atNeedle)) {
        return index + 1;
      }
    }

    if (userNeedle) {
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(userNeedle)) {
          return index + 1;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

function buildReasoningSteps({ baseResult, mentorReview, webContexts, webFailures }) {
  const steps = [];
  steps.push(`I first selected the ${baseResult.debug.source} strategy.`);
  steps.push(`I estimated confidence at ${Number(baseResult.debug.confidence || 0).toFixed(2)}.`);
  if (webContexts.length) {
    steps.push(`I integrated ${webContexts.length} source(s) from URLs or documents.`);
  }
  if (webFailures.length) {
    steps.push(`I skipped ${webFailures.length} source(s) due to parsing or fetch issues.`);
  }
  if (mentorReview.used) {
    steps.push(
      `I received mentor feedback: ${mentorReview.verdict || 'unknown'} (${Number(
        mentorReview.score || 0
      ).toFixed(2)}).`
    );
  } else {
    steps.push(`Mentor review was skipped: ${mentorReview.reason || 'not_enabled'}.`);
  }
  return steps;
}

async function runChatPipeline({ message, sessionId, urls, mentorEnabledOverride, webOptions, onProgress }) {
  const pipelineStartedAt = Date.now();
  const resolvedSessionId =
    typeof sessionId === 'string' && sessionId.trim() ? sessionId : crypto.randomUUID();

  let queryMessage = message.trim();
  let isForceSearch = false;
  if (/^(search|search it|deep research|deep research it)$/i.test(queryMessage)) {
    const history = store.state.interactions.filter(i => i.sessionId === resolvedSessionId && !['web_ingest', 'starter_bootstrap'].includes(i.source));
    if (history.length > 0) {
      queryMessage = history[history.length - 1].user.replace(/ \[MENTOR\]$/, '');
      isForceSearch = true;
    }
  }

  brain.ensureSession(resolvedSessionId);
  const contextAwareMessage = brain.buildContextAwareQuery(resolvedSessionId, queryMessage);
  // Early abuse guard: if the user input is abusive, return a short non-engaging reply.
  try {
    if (brain.isAbusive(queryMessage) || brain.isAbusive(contextAwareMessage)) {
      const abuseReply = 'I will not engage with abusive language. If you want help, please ask respectfully.';
      store.state.stats.messages += 1;
      store.state.interactions.push({
        sessionId: resolvedSessionId,
        user: queryMessage,
        bot: abuseReply,
        source: 'abuse_guard',
        confidence: 0.5,
        at: new Date().toISOString()
      });
      store.scheduleSave(['core', 'interactions']);
      return {
        sessionId: resolvedSessionId,
        reply: abuseReply,
        reasoningSummary: '',
        reasoningSteps: [],
        debug: { source: 'abuse_guard', confidence: 0.5 }
      };
    }
  } catch (err) {
    debug('abuse-guard-error', String(err));
  }
  const contextTransformed = contextAwareMessage !== queryMessage;
  const contextPrepended =
    contextTransformed &&
    contextAwareMessage.endsWith(queryMessage) &&
    contextAwareMessage.length > queryMessage.length;
  const contextRewrite = contextTransformed && !contextPrepended;

  const extractedUrls = webLearner.extractUrls(queryMessage);
  const extraUrls = Array.isArray(urls) ? urls.filter((item) => typeof item === 'string') : [];
  const mergedUrls = [...new Set([...extractedUrls, ...extraUrls])];

  const resolvedWebOptions =
    webOptions && typeof webOptions === 'object' && !Array.isArray(webOptions)
      ? { ...webOptions }
      : {};

  const identityModelQuestion = isModelIdentityQuestion(queryMessage);
  const noOutsideAiMode = parseBooleanEnv(resolvedWebOptions.noOutsideAiMode, noOutsideAiDefaultEnabled);
  const lowSignalInput = brain.isLowSignalInput(contextAwareMessage);
  const smallTalkInput = Boolean(brain.buildSmallTalkCandidate(contextAwareMessage));
  const brainOnlyMode = noOutsideAiMode || identityModelQuestion || lowSignalInput || smallTalkInput;

  if (/deep research/i.test(message)) {
    resolvedWebOptions.recurseDepth = Math.max(resolvedWebOptions.recurseDepth || 0, 2);
    resolvedWebOptions.maxRecursiveUrls = Math.max(resolvedWebOptions.maxRecursiveUrls || 0, 20);
  }

  const forceHeavyMode = parseBooleanEnv(resolvedWebOptions.forceHeavyMode, false) || isForceSearch;
  const fastLocalMode = !forceHeavyMode && mergedUrls.length === 0 && shouldUseFastLocalPath(queryMessage);

  const webScrapeLog = [];
  const reportProgress = (event) => {
    const entry = {
      at: new Date().toISOString(),
      ...event
    };
    webScrapeLog.push(entry);
    if (webScrapeLog.length > 120) {
      webScrapeLog.shift();
    }

    if (typeof onProgress === 'function') {
      onProgress(entry);
    }
  };

  const searchEnabled = brainOnlyMode
    ? false
    : parseBooleanEnv(resolvedWebOptions.searchEnabled, webSearchDefaultEnabled);
  const searchMaxResults = Number(resolvedWebOptions.searchMaxResults || process.env.WEB_SEARCH_MAX_RESULTS || 5);
  let webSearch = {
    used: false,
    ok: false,
    reason: 'not_used',
    provider: null,
    query: null,
    urls: []
  };

  let crawlSeedUrls = [...mergedUrls];
  if (!fastLocalMode && crawlSeedUrls.length === 0 && searchEnabled && (isForceSearch || shouldUseAutoWebSearch(queryMessage))) {
    reportProgress({ type: 'search_start', query: queryMessage, maxResults: searchMaxResults });

    const searchResult = await webLearner.searchWeb(queryMessage, {
      enabled: searchEnabled,
      maxResults: searchMaxResults
    });

    webSearch = {
      used: true,
      ok: searchResult.ok,
      reason: searchResult.reason || 'unknown',
      provider: searchResult.provider || null,
      query: searchResult.query || queryMessage,
      urls: Array.isArray(searchResult.urls) ? searchResult.urls : []
    };

    if (webSearch.urls.length > 0) {
      crawlSeedUrls = webSearch.urls;
    }

    reportProgress({
      type: 'search_done',
      ok: webSearch.ok,
      reason: webSearch.reason,
      provider: webSearch.provider,
      urlCount: webSearch.urls.length
    });
  }

  const crawl = fastLocalMode || brainOnlyMode
    ? {
        contexts: [],
        failures: [],
        stats: {
          seeds: 0,
          fetchedPages: 0,
          failures: 0,
          recurseDepth: 0,
          maxPages: 0,
          maxHrefsPerPage: 0
        }
      }
    : await webLearner.crawlFromUrls(crawlSeedUrls, {
        ...resolvedWebOptions,
        onProgress: reportProgress
      });
  const webContexts = crawl.contexts;
  const webFailures = crawl.failures;

  for (const context of webContexts) {
    brain.ingestWebsiteKnowledge({
      url: context.url,
      title: context.title,
      text: context.text,
      sessionId: resolvedSessionId
    });
  }

  const neuralRequested =
    fastLocalMode || brainOnlyMode ? false : parseBooleanEnv(resolvedWebOptions.neuralEnabled, neuralPrimaryDefaultEnabled);
  const neuralActive = neuralRequested && neuralResponder.enabled;
  let neuralResult = {
    used: false,
    reason: fastLocalMode ? 'fast_local_mode' : neuralRequested ? 'neural_not_configured' : 'neural_disabled'
  };

  if (neuralActive) {
    reportProgress({ type: 'neural_start' });
    neuralResult = await neuralResponder.generateReply({
      message: contextAwareMessage,
      webContext: webContexts,
      topFacts: brain.getRelevantFacts(contextAwareMessage, 3)
    });
    reportProgress({
      type: 'neural_done',
      ok: neuralResult.ok,
      reason: neuralResult.reason || null,
      confidence: neuralResult.confidence || null
    });
  }

  const result = neuralResult.ok
    ? brain.ingestExternalReply({
        sessionId: resolvedSessionId,
        message: contextAwareMessage,
        reply: neuralResult.reply,
        source: 'neural_primary',
        confidence: neuralResult.confidence,
        webContexts
      })
    : await brain.chat({
        sessionId: resolvedSessionId,
        message: contextAwareMessage,
        webContexts
      });

  const mentorRequested = fastLocalMode || brainOnlyMode ? false : parseBooleanEnv(mentorEnabledOverride, mentorDefaultEnabled);
  const botConfidence = result.debug.confidence || 0;
  const botDoesNotKnow = botConfidence < 0.6 || /i don'?t know|i am not sure|i'm not sure|i cannot answer|i can'?t answer/i.test(result.reply);
  const noWebSourcesFound = (webSearch.used || crawlSeedUrls.length > 0) && webContexts.length === 0;
  const mentorActive = mentorRequested && mentorAI.enabled && (botDoesNotKnow || noWebSourcesFound);

  const mentorStartedAt = Date.now();
  if (mentorActive) {
    reportProgress({ type: 'mentor_start', reason: botDoesNotKnow ? 'bot_uncertain' : 'no_web_sources' });
  }
  const mentorReview = mentorActive
    ? await mentorAI.reviewReply({
        userMessage: contextAwareMessage,
        candidateReply: result.reply,
        webContext: webContexts
      })
    : {
        used: false,
        reason: mentorRequested ? ((botDoesNotKnow || noWebSourcesFound) ? 'mentor_not_configured' : 'bot_confident') : 'mentor_disabled'
      };
  if (mentorActive) {
    reportProgress({ type: 'mentor_done', verdict: mentorReview.verdict });
  }
  const mentorDurationMs = Date.now() - mentorStartedAt;

  logger.info(
    {
      sessionId: resolvedSessionId,
      mentorUsed: mentorReview.used,
      mentorVerdict: mentorReview.verdict || 'not_used',
      mentorScore: mentorReview.score || 0,
      mentorReason: mentorReview.reason || null,
      mentorDurationMs,
      mentorRequested,
      mentorActive,
      webUrlsProcessed: webContexts.length,
      webUrlsFailed: webFailures.length
    },
    'mentor_review'
  );

  let finalReply = result.reply;
  let memoryCorrected = false;
  let memoryCorrectionReason = null;

  const mentorMarksCompletelyWrong =
    mentorReview.used &&
    (mentorReview.verdict === 'unsafe' ||
      (mentorReview.verdict === 'improve' && Number(mentorReview.score || 0) <= 0.25) ||
      botDoesNotKnow);

  if (mentorMarksCompletelyWrong && mentorReview.improvedReply && result.debug.memoryRef) {
    const replacementCheck = brain.replaceIncorrectMemory({
      memoryRef: result.debug.memoryRef,
      message: contextAwareMessage,
      badReply: result.reply,
      correctedReply: mentorReview.improvedReply
    });

    memoryCorrected = replacementCheck.removed;
    memoryCorrectionReason = replacementCheck.reason || null;

    if (memoryCorrected) {
      logger.warn(
        {
          sessionId: resolvedSessionId,
          source: result.debug.source,
          mentorVerdict: mentorReview.verdict,
          mentorScore: mentorReview.score || 0,
          memoryInteractionIndex: result.debug.memoryRef.interactionIndex
        },
        'mentor_purged_incorrect_memory'
      );
    }
  }

  if (mentorReview.used && mentorReview.improvedReply) {
    if (!violatesStudentVoice(mentorReview.improvedReply)) {
      finalReply = mentorReview.improvedReply;
      brain.reinforceWithMentor({
        sessionId: resolvedSessionId,
        message: contextAwareMessage,
        finalReply,
        feedback: mentorReview.feedback
      });

      logger.info(
        {
          sessionId: resolvedSessionId,
          mentorVerdict: mentorReview.verdict,
          mentorScore: mentorReview.score || 0
        },
        'mentor_applied_correction'
      );
    } else {
      logger.warn(
        {
          sessionId: resolvedSessionId,
          mentorVerdict: mentorReview.verdict,
          mentorScore: mentorReview.score || 0,
          memoryCorrected,
          memoryCorrectionReason
        },
        'mentor_correction_rejected_voice_guard'
      );
    }
  }

  if (crawlSeedUrls.length > 0 && webContexts.length === 0 && webFailures.length > 0) {
    const reasons = [...new Set(webFailures.map((item) => item.reason))].join(', ');
    finalReply = `${finalReply} I could not learn from those URL(s) yet: ${reasons}.`;
  }

  // Global anti-repeat guard: if the last bot reply (global) matches this
  // reply nearly exactly, avoid repeating the same text across messages
  // (helps when clients don't supply a persistent sessionId).
  try {
    const globalLast = store.state.lastBotReply || null;
    if (!identityModelQuestion && globalLast) {
      const normFinal = brain.normalize(finalReply || '');
      const normGlobal = brain.normalize(globalLast || '');
      const similarity = normFinal && normGlobal ? brain.scoreSimilarity(finalReply || '', globalLast || '') : 0;
      if (normFinal && normGlobal && (normFinal === normGlobal || similarity > 0.95)) {
        const altSmall = brain.buildSmallTalkCandidate(contextAwareMessage);
        if (altSmall && altSmall.text && altSmall.text !== finalReply) {
          finalReply = altSmall.text;
        } else {
          finalReply = 'I may be repeating myself — would you like me to explain that differently or give an example?';
        }
      }
    }
  } catch (err) {
    // best-effort; don't fail the pipeline on guard check
    debug('anti-repeat-guard-error', String(err));
  }

  if (identityModelQuestion || violatesStudentVoice(finalReply)) {
    finalReply =
      'I am your local learning student bot running in this project. I use my own memory and training pipeline here, and in NO OUTSIDE AI MODE I do not use external AI services.';
  }

  const responseTokens = countResponseTokens(finalReply);
  const durationMs = Date.now() - pipelineStartedAt;
  const tokensPerSecond = durationMs > 0 ? responseTokens / (durationMs / 1000) : 0;
  const memoryReadLine = await resolveMemoryLineReference(result.debug.memoryRef);

  const reasoningSummary = buildReasoningSummary({
    baseResult: result,
    mentorReview,
    webContexts,
    webFailures
  });
  const reasoningSteps = buildReasoningSteps({
    baseResult: result,
    mentorReview,
    webContexts,
    webFailures
  });

  store.scheduleSave(['core']);

  // Persist global last bot reply to help avoid cross-session repeats
  try {
    store.state.lastBotReply = finalReply;
    store.state.lastBotAt = new Date().toISOString();
  } catch (err) {
    debug('persist-last-reply-failed', String(err));
  }

  return {
    sessionId: resolvedSessionId,
    reply: finalReply,
    reasoningSummary,
    reasoningSteps,
    debug: {
      ...result.debug,
      webUrlsProcessed: webContexts.length,
      webUrlsFailed: webFailures,
      webCrawl: crawl.stats,
      webSearch,
      neuralRequested,
      neuralActive,
      neuralUsed: neuralResult.ok || false,
      neuralReason: neuralResult.reason || null,
      neuralReasoning: neuralResult.reasoning || null,
      fastLocalMode,
      noOutsideAiMode,
      brainOnlyMode,
      identityModelQuestion,
      lowSignalInput,
      smallTalkInput,
      contextTransformed,
      contextPrepended,
      contextRewrite,
      contextQueryUsed: contextAwareMessage,
      webScrapeLog,
      mentorUsed: mentorReview.used,
      mentorVerdict: mentorReview.verdict || 'not_used',
      mentorScore: mentorReview.score || 0,
      mentorFeedback: mentorReview.feedback || mentorReview.reason || null,
      mentorRequested,
      mentorActive,
      memoryCorrected,
      memoryCorrectionReason,
      responseTokens,
      tokensPerSecond: Number(tokensPerSecond.toFixed(2)),
      durationMs,
      memoryReadLine,
      memoryReadIndex: result.debug.memoryRef?.interactionIndex ?? null
    }
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/stats', (req, res) => {
  const neuralState = store.state.neural || {};

  res.json({
    ...store.state.stats,
    interactions: store.state.interactions.length,
    learnedFacts: Object.keys(store.state.learnedFacts).length,
    learnedConcepts: Object.keys(store.state.conceptGraph || {}).length,
    webSources: Object.keys(store.state.webKnowledge || {}).length,
    starterLessons: Object.keys(store.state.starterLessons || {}).length,
    mentorConfigured: mentorAI.enabled,
    mentorDefaultEnabled,
    mentorEnabled: mentorAI.enabled && mentorDefaultEnabled,
    noOutsideAiDefaultEnabled,
    neuralConfigured: neuralResponder.enabled,
    neuralDefaultEnabled: neuralPrimaryDefaultEnabled,
    neuralPrimaryEnabled: neuralResponder.enabled && neuralPrimaryDefaultEnabled,
    neuralLocalEnabled: true,
    neuralLocalDimension: Number(neuralState.dim) || 48,
    neuralLocalTrainedSamples: Number(neuralState.trainedSamples) || 0,
    neuralLocalPrototypes: Array.isArray(neuralState.prototypes) ? neuralState.prototypes.length : 0,
    trainer: store.state.trainer
  });
});

app.get('/api/neural/graph', (req, res) => {
  const neuralState = store.state.neural || {};
  const prototypes = Array.isArray(neuralState.prototypes) ? neuralState.prototypes : [];

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(80, requestedLimit)) : 20;
  const requestedMinEdge = Number(req.query.minEdge);
  const minEdge = Number.isFinite(requestedMinEdge) ? Math.max(0, Math.min(1, requestedMinEdge)) : 0.55;

  const sorted = prototypes
    .slice()
    .sort((left, right) => (Number(right.count) || 0) - (Number(left.count) || 0))
    .slice(0, limit);

  const nodes = sorted.map((item, index) => ({
    id: String(index),
    label: String(item.reply || 'prototype').replace(/\s+/g, ' ').trim().slice(0, 36),
    source: String(item.source || 'unknown'),
    weight: Number(item.count) || 1
  }));

  const edges = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex];
    if (!Array.isArray(left.vector)) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const right = sorted[rightIndex];
      if (!Array.isArray(right.vector)) {
        continue;
      }

      const similarity = cosineSimilarityVectors(left.vector, right.vector);
      if (similarity < minEdge) {
        continue;
      }

      edges.push({
        from: String(leftIndex),
        to: String(rightIndex),
        weight: Number(similarity.toFixed(3))
      });
    }
  }

  res.json({
    ok: true,
    dimension: Number(neuralState.dim) || 48,
    trainedSamples: Number(neuralState.trainedSamples) || 0,
    totalPrototypes: prototypes.length,
    nodes,
    edges
  });
});

app.post('/api/neural/import-all', async (req, res, next) => {
  try {
    const { async: asyncRequested, wait } = req.body || {};
    const runAsync = parseBooleanEnv(asyncRequested, !parseBooleanEnv(wait, false));

    if (!runAsync) {
      const result = await brain.importAllMemoryToNeuralAsync();
      store.scheduleSave(['neural']);
      return res.json({
        ok: true,
        mode: 'sync',
        ...result
      });
    }

    const job = startNeuralImportJob();
    return res.status(202).json({
      ok: true,
      mode: 'async',
      jobId: job.id,
      status: job.status,
      progress: job.progress
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/neural/import-all/:jobId', (req, res) => {
  const jobId = String(req.params.jobId || '').trim();
  if (!jobId || !neuralImportJobs.has(jobId)) {
    return res.status(404).json({ error: 'job_not_found' });
  }

  const job = neuralImportJobs.get(jobId);
  return res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    result: job.result,
    error: job.error
  });
});

app.post('/api/learn/lesson', async (req, res, next) => {
  try {
    const { lesson, lessons } = req.body || {};
    const incoming = Array.isArray(lessons) ? lessons : lesson ? [lesson] : [];

    if (!incoming.length) {
      return res.status(400).json({
        error: 'Provide `lesson` object or `lessons` array in request body'
      });
    }

    const results = incoming.map((item) => {
      const outcome = brain.ingestStarterLesson(item);
      return {
        id: String(item?.id || ''),
        topic: String(item?.topic || ''),
        ...outcome
      };
    });

    const loadedCount = results.filter((item) => item.loaded).length;
    if (loadedCount > 0) {
      store.scheduleSave(['knowledge', 'language', 'core']);
    }

    res.json({
      accepted: incoming.length,
      loadedCount,
      skippedCount: incoming.length - loadedCount,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/learn/facts', async (req, res, next) => {
  try {
    const { fact, facts, source, sessionId } = req.body || {};
    const incoming = Array.isArray(facts)
      ? facts
      : typeof fact === 'string'
        ? [fact]
        : [];

    if (!incoming.length) {
      return res.status(400).json({
        error: 'Provide `fact` string or `facts` array in request body'
      });
    }

    const results = incoming.map((item) =>
      brain.ingestFact(item, {
        source: source || 'api_fact_ingest',
        sessionId: sessionId || 'fact-seed'
      })
    );

    const learnedCount = results.filter((item) => item.learned).length;
    if (learnedCount > 0) {
      store.scheduleSave(['knowledge', 'language', 'interactions', 'core']);
    }

    res.json({
      accepted: incoming.length,
      learnedCount,
      skippedCount: incoming.length - learnedCount,
      learnedFactsTotal: Object.keys(store.state.learnedFacts || {}).length,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/persist', async (req, res, next) => {
  try {
    await store.persist();
    res.json({
      ok: true,
      persistedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const { message, sessionId, urls, mentorEnabled, webOptions } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const result = await runChatPipeline({
      message: message.trim(),
      sessionId,
      urls,
      mentorEnabledOverride: mentorEnabled,
      webOptions
    });

    res.json({
      sessionId: result.sessionId,
      reply: result.reply,
      reasoning: result.reasoningSummary,
      reasoningSteps: result.reasoningSteps,
      debug: result.debug
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat/stream', async (req, res, next) => {
  try {
    const { message, sessionId, urls, mentorEnabled, webOptions } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const sendEvent = (type, payload) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent('stage', { label: 'Analyzing your message...' });
    sendEvent('thinking', { text: 'I am reading your message and identifying your intent.' });
    sendEvent('thinking', { text: 'I am checking memory, math/English rules, and available sources.' });
    const result = await runChatPipeline({
      message: message.trim(),
      sessionId,
      urls,
      mentorEnabledOverride: mentorEnabled,
      webOptions,
      onProgress: (progressEvent) => {
        sendEvent('scrape', progressEvent);
      }
    });

    sendEvent('reasoning', { text: result.reasoningSummary });
    for (const step of result.reasoningSteps) {
      sendEvent('thinking', { text: step });
    }
    sendEvent('stage', { label: 'Generating final response...' });

    const tokens = result.reply.split(/(\s+)/).filter(Boolean);
    const streamTokenStart = Date.now();
    for (const token of tokens) {
      sendEvent('token', { token });
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
    const streamDurationMs = Date.now() - streamTokenStart;
    const streamedTokensPerSecond = streamDurationMs > 0 ? tokens.length / (streamDurationMs / 1000) : 0;

    sendEvent('done', {
      sessionId: result.sessionId,
      reply: result.reply,
      reasoning: result.reasoningSummary,
      reasoningSteps: result.reasoningSteps,
      debug: {
        ...result.debug,
        streamDurationMs,
        streamedTokens: tokens.length,
        streamedTokensPerSecond: Number(streamedTokensPerSecond.toFixed(2))
      }
    });
    res.end();
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((error, req, res, next) => {
  logger.error({ err: error }, 'unhandled_error');
  debug('Unhandled error: %O', error);
  res.status(500).json({ error: 'internal_error' });
});

async function start() {
  await store.init();

  const starterFilePath = path.join(__dirname, '..', 'data', 'starter-lessons.json');
  try {
    const raw = await fs.promises.readFile(starterFilePath, 'utf8');
    const lessons = JSON.parse(raw);
    if (Array.isArray(lessons)) {
      let loadedCount = 0;
      for (const lesson of lessons) {
        const result = brain.ingestStarterLesson(lesson);
        if (result.loaded) {
          loadedCount += 1;
        }
      }

      if (loadedCount > 0) {
        logger.info({ loadedCount }, 'starter_lessons_loaded');
        store.scheduleSave(['knowledge', 'language', 'core']);
      }
    }
  } catch (error) {
    logger.warn({ err: error }, 'starter_lessons_not_loaded');
  }

  setInterval(() => {
    const result = brain.runTrainerTick(40);
    if (result.processed > 0) {
      logger.debug({ processed: result.processed, remaining: result.remaining }, 'trainer_tick');
    }
  }, 5000);

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'server_started');

    if (neuralImportOnStartDefaultEnabled) {
      setImmediate(() => {
        const job = startNeuralImportJob();
        logger.info({ jobId: job.id }, 'neural_memory_import_started');
      });
    } else {
      logger.info({ enabled: false }, 'neural_import_on_start');
    }
  });
}

start().catch((error) => {
  logger.error({ err: error }, 'failed_to_start');
  process.exit(1);
});