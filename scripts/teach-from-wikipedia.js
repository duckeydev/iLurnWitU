const fs = require('fs');
const path = require('path');

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function uniqueById(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

async function fetchWikiSummary(topic) {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
  );
  if (!res.ok) throw new Error(`Summary fetch failed: ${topic}`);
  return res.json();
}

async function fetchWikiSections(topic) {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
      topic
    )}&prop=sections&format=json&origin=*`
  );
  if (!res.ok) throw new Error(`Section fetch failed: ${topic}`);
  return res.json();
}

async function fetchSectionText(topic, sectionIndex) {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
      topic
    )}&prop=text&section=${sectionIndex}&format=json&origin=*`
  );
  if (!res.ok) throw new Error(`Section content failed: ${topic}`);
  const data = await res.json();
  return data.parse?.text?.['*'] || '';
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function buildWikiLessons(topics, maxSections = 3) {
  const lessons = [];
  let idCounter = 1;

  for (const topic of topics) {
    const summary = await fetchWikiSummary(topic);

    lessons.push({
      id: `wiki-${idCounter++}`,
      topic: topic.toLowerCase(),
      content: `Wikipedia summary (${topic}): ${summary.extract}`
    });

    const sectionsData = await fetchWikiSections(topic);
    const sections = (sectionsData.parse?.sections || []).slice(0, maxSections);

    for (const section of sections) {
      const rawHtml = await fetchSectionText(topic, section.index);
      const cleanText = stripHtml(rawHtml).slice(0, 2000);

      if (cleanText.length > 200) {
        lessons.push({
          id: `wiki-${idCounter++}`,
          topic: topic.toLowerCase(),
          content: `Wikipedia section (${topic} - ${section.line}): ${cleanText}`
        });
      }
    }
  }

  return uniqueById(lessons);
}

async function teachViaApi({ apiBaseUrl, lessons, chunkSize }) {
  let loadedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < lessons.length; i += chunkSize) {
    const chunk = lessons.slice(i, i + chunkSize);

    const response = await fetch(`${apiBaseUrl}/api/learn/lesson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessons: chunk })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    loadedCount += Number(data.loadedCount || 0);
    skippedCount += Number(data.skippedCount || 0);
  }

  return { loadedCount, skippedCount };
}

function teachViaFile({ filePath, lessons }) {
  let existing = [];

  if (fs.existsSync(filePath)) {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  const byId = new Map(existing.map((l) => [l.id, l]));
  for (const lesson of lessons) {
    if (!byId.has(lesson.id)) {
      byId.set(lesson.id, lesson);
    }
  }

  const merged = [...byId.values()];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));

  return { total: merged.length };
}

async function main() {
  const topicsArg = getArg('--topics', 'Bacteriophage,Operating system,Neural network');
  const topics = topicsArg.split(',').map((t) => t.trim());

  const mode = getArg('--mode', 'both');
  const apiBaseUrl = getArg('--api', 'http://localhost:3000');
  const chunkSize = Number(getArg('--chunk', '20'));
  const outFile = path.resolve(getArg('--out', './data/wiki-lessons.json'));

  const lessons = await buildWikiLessons(topics);

  console.log(`Prepared ${lessons.length} Wikipedia lessons.`);

  if (mode === 'api' || mode === 'both') {
    const result = await teachViaApi({ apiBaseUrl, lessons, chunkSize });
    console.log(`API loaded=${result.loadedCount}, skipped=${result.skippedCount}`);
  }

  if (mode === 'file' || mode === 'both') {
    const result = teachViaFile({ filePath: outFile, lessons });
    console.log(`File totalLessons=${result.total}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});