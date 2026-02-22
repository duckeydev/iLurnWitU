import process from "process";
import os from "os";
import { setTimeout as sleep } from "timers/promises";

const args = process.argv.slice(2);

function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  return args[i + 1];
}

function getBooleanArg(name, def = false) {
  const value = getArg(name, def ? "true" : "false");
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

// Config
const COUNT = parseInt(getArg("count", "1175000"));
const API = getArg("api", "http://localhost:3000");
const DELAY = parseInt(getArg("delay", "5"));
const RETRIES = parseInt(getArg("retries", "1000"));
const IMPORT_NEURAL = getBooleanArg("importNeural", true);
const LOG_LEVEL = getArg("logLevel", process.env.LOG_LEVEL || "info").toLowerCase();
const BATCH_SIZE = parseInt(getArg("batch", "50"));
const CORES = parseInt(getArg("cores", os.cpus().length));
const IMPORT_POLL_MS = parseInt(getArg("importPollMs", "1200"));
const IMPORT_TIMEOUT_MS = parseInt(getArg("importTimeoutMs", "18000000"));
const CHECKPOINT_EVERY_BATCH = getBooleanArg("checkpointEveryBatch", true);

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = LEVELS[LOG_LEVEL] ?? LEVELS.debug;

function log(level, message, meta) {
  if ((LEVELS[level] ?? LEVELS.info) > activeLevel) return;
  const ts = new Date().toISOString();
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${suffix}`);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

// Expanded Domains
const DOMAINS = [
  "Mathematics","Logic","Linguistics","Computer programming","Physics","Chemistry","Biology",
  "Economics","Psychology","Philosophy","History","Political science","Sociology","Systems theory",
  "Information theory","Cognitive science","Game theory","Statistics","Engineering",
  "Human-computer interaction","Cybersecurity","Art","Anthropology","Ecology","Autobiographies",
  "Biographies","Medicine","Neuroscience","Astronomy","Geology","Music","Theater","Film studies",
  "Literature","AI Ethics","Robotics","Nanotechnology","Blockchain","Cryptography","Law","Urban planning",
  "Linguistic anthropology","Cultural studies","Environmental science","Ethics","Machine Learning","Deep Learning"
];

// Unique Lesson ID
function generateLessonID(i) {
  return `lesson-${Date.now()}-${i}-${Math.floor(Math.random()*1e6)}`;
}

function buildLesson(domain, i) {
  return {
    id: generateLessonID(i),
    topic: domain,
    content: `
Advanced Lesson ${i} in ${domain}

Definition:
Core principles that define ${domain} and its underlying structures.

Mechanism:
How systems in ${domain} operate through causality, feedback, and constraints.

Example:
A concrete real-world application showing ${domain} in action.

Misconception:
A common false belief within ${domain} and why it is incorrect.

Cross-Domain Link:
How ${domain} connects to at least one other field in this curriculum.
`,
  };
}

function buildFactsForLesson(domain) {
  return [
    `${domain} uses causality, feedback, and constraints to explain systems.`,
    `${domain} connects with other fields through cross-domain reasoning.`
  ];
}

async function safePost(body, attempt = 0) {
  try {
    const res = await fetch(`${API}/api/learn/lesson`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log("debug", "Lesson posted", { id: body.lesson?.id, status: res.status });
  } catch (e) {
    if (attempt >= RETRIES) {
      log("error", "Failed after retries", { id: body.lesson?.id, topic: body.lesson?.topic, error: e.message });
      throw e;
    }
    log("warn", "Retrying lesson post", { id: body.lesson?.id, attempt: attempt + 1 });
    await sleep(600);
    return safePost(body, attempt + 1);
  }
}

async function safePostFacts(facts, attempt = 0) {
  try {
    const res = await fetch(`${API}/api/learn/facts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts, source: "curriculum_fact" })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= RETRIES) {
      log("error", "Fact ingest failed after retries", { attempt: attempt + 1, error: e.message });
      throw e;
    }
    await sleep(600);
    return safePostFacts(facts, attempt + 1);
  }
}

// Batch runner for parallel cores
async function runBatch(start, end) {
  for (let i = start; i <= end; i++) {
    const domain = DOMAINS[i % DOMAINS.length];
    const lesson = buildLesson(domain, i);
    await safePost({ lesson });
    const facts = buildFactsForLesson(domain);
    await safePostFacts(facts);
    if (i % 100 === 0) log("info", `Progress: ${i}/${COUNT}`, { topic: domain });
    await sleep(DELAY);
  }
}

async function getNeuralSnapshot() {
  try {
    const res = await fetch(`${API}/api/stats`);
    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return {
      trainedSamples: Number(data.neuralLocalTrainedSamples) || 0,
      prototypes: Number(data.neuralLocalPrototypes) || 0,
      dim: Number(data.neuralLocalDimension) || 0
    };
  } catch {
    return null;
  }
}

async function checkpointPersist() {
  const res = await fetch(`${API}/api/persist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  if (!res.ok) {
    throw new Error(`Persist checkpoint failed: HTTP ${res.status}`);
  }

  return await res.json();
}

async function main() {
  const runStartedAt = Date.now();
  log("info", `Launching injection: ${COUNT} lessons, ${CORES} cores, batch ${BATCH_SIZE}`, { api: API });

  const totalBatches = Math.ceil(COUNT / BATCH_SIZE);
  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE + 1;
    const end = Math.min((b + 1) * BATCH_SIZE, COUNT);
    log("info", `Processing batch ${b + 1}/${totalBatches}`, { start, end });
    
    // Split batch across cores
    const batchSizePerCore = Math.ceil((end - start + 1) / CORES);
    const promises = [];
    for (let c = 0; c < CORES; c++) {
      const coreStart = start + c * batchSizePerCore;
      const coreEnd = Math.min(coreStart + batchSizePerCore - 1, end);
      if (coreStart > coreEnd) continue;
      promises.push(runBatch(coreStart, coreEnd));
    }
    await Promise.all(promises);

    if (CHECKPOINT_EVERY_BATCH) {
      const checkpoint = await checkpointPersist();
      log("debug", "Batch checkpoint persisted", {
        batch: b + 1,
        persistedAt: checkpoint?.persistedAt || null
      });
    }
  }

  if (IMPORT_NEURAL) {
    const before = await getNeuralSnapshot();
    if (before) {
      log("info", "Neural BEFORE import", before);
    }

    log("info", "Importing all memory into neural network");
    const res = await fetch(`${API}/api/neural/import-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ async: true })
    });
    if (!res.ok) throw new Error(`Neural import failed: HTTP ${res.status}`);
    const started = await res.json();

    if (!started?.jobId) {
      const after = await getNeuralSnapshot();
      log("info", "Neural import complete", {
        importedSamples: started.importedSamples,
        trainedSamples: started.trainedSamples,
        neuralPrototypes: started.neuralPrototypes,
        neuralDim: started.neuralDim
      });
      if (before && after) {
        log("info", "Neural AFTER import", after);
        log("info", "Neural DELTA", {
          trainedSamples: after.trainedSamples - before.trainedSamples,
          prototypes: after.prototypes - before.prototypes
        });
      }
    } else {
      const startedAt = Date.now();
      let lastLogAt = 0;

      while (true) {
        if (Date.now() - startedAt > IMPORT_TIMEOUT_MS) {
          throw new Error(`Neural import timed out after ${IMPORT_TIMEOUT_MS}ms`);
        }

        const statusRes = await fetch(`${API}/api/neural/import-all/${started.jobId}`);
        if (!statusRes.ok) {
          throw new Error(`Neural import status failed: HTTP ${statusRes.status}`);
        }

        const status = await statusRes.json();
        const progress = status.progress || {};

        const now = Date.now();
        if (now - lastLogAt > 2000) {
          lastLogAt = now;
          log("info", "Neural import progress", {
            status: status.status,
            consideredSamples: progress.consideredSamples || 0,
            importedSamples: progress.importedSamples || 0,
            trainedSamples: progress.trainedSamples || 0,
            neuralPrototypes: progress.neuralPrototypes || 0
          });
        }

        if (status.status === "done") {
          const result = status.result || {};
          const after = await getNeuralSnapshot();
          log("info", "Neural import complete", {
            importedSamples: result.importedSamples,
            trainedSamples: result.trainedSamples,
            neuralPrototypes: result.neuralPrototypes,
            neuralDim: result.neuralDim
          });
          if (before && after) {
            log("info", "Neural AFTER import", after);
            log("info", "Neural DELTA", {
              trainedSamples: after.trainedSamples - before.trainedSamples,
              prototypes: after.prototypes - before.prototypes
            });
          }
          break;
        }

        if (status.status === "failed") {
          throw new Error(`Neural import failed: ${status.error || "unknown_error"}`);
        }

        await sleep(IMPORT_POLL_MS);
      }
    }
  }

  const elapsedMs = Date.now() - runStartedAt;
  log("info", "Curriculum injection complete", {
    totalInjected: COUNT,
    elapsedMs,
    elapsedHuman: formatDuration(elapsedMs)
  });
}

main().catch(e => {
  log("error", "Curriculum failed", { error: e.message });
  process.exit(1);
});