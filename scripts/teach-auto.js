import fs from "fs";
import path from "path";
import process from "process";

const args = process.argv.slice(2);

function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  return args[i + 1];
}

const COUNT = parseInt(getArg("count", "100"));
const API = getArg("api", "http://localhost:3000");
const DELAY = parseInt(getArg("delay", "300"));
const RETRIES = parseInt(getArg("retries", "3"));
const TOPIC = getArg("topic", "general-knowledge");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safePost(body, attempt = 0) {
  try {
    const res = await fetch(`${API}/api/learn/lesson`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    if (attempt >= RETRIES) throw e;
    await sleep(500);
    return safePost(body, attempt + 1);
  }
}

function generateLesson(i) {
  return {
    id: `auto-${Date.now()}-${i}`,
    topic: TOPIC,
    content: `
Lesson ${i} on ${TOPIC}:

Core Principle:
${TOPIC} involves structured reasoning, cause and effect, and real-world application.

Deep Explanation:
Understanding ${TOPIC} requires connecting concepts, forming associations, and recognizing patterns across domains.

Applied Example:
If applied in programming, science, writing, or mathematics, ${TOPIC} strengthens analytical thinking and abstraction skills.

Key Takeaways:
- Concepts interconnect.
- Patterns repeat across domains.
- Learning compounds over time.
`
  };
}

async function main() {
  console.log(`Teaching ${COUNT} lessons...`);

  for (let i = 1; i <= COUNT; i++) {
    const lesson = generateLesson(i);
    await safePost({ lesson });
    process.stdout.write(`✔ ${i}/${COUNT}\r`);
    await sleep(DELAY);
  }

  console.log("\nDone.");
}

main();