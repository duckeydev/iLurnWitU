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
    if (!item || !item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function buildEnglishLessons() {
  const lessons = [];

  const singularSubjects = ['He', 'She', 'The student', 'My friend', 'That dog'];
  const pluralSubjects = ['They', 'We', 'The students', 'My friends', 'Those dogs'];
  const singularVerbs = ['writes', 'runs', 'speaks', 'studies', 'works'];
  const pluralVerbs = ['write', 'run', 'speak', 'study', 'work'];

  let index = 1;

  for (let i = 0; i < singularSubjects.length; i += 1) {
    lessons.push({
      id: `eng-sva-${index}`,
      topic: 'english-grammar',
      content: `Subject-verb agreement: use singular verbs with singular subjects. Example: "${singularSubjects[i]} ${singularVerbs[i]} every day."`
    });
    index += 1;
  }

  for (let i = 0; i < pluralSubjects.length; i += 1) {
    lessons.push({
      id: `eng-sva-${index}`,
      topic: 'english-grammar',
      content: `Subject-verb agreement: use base verbs with plural subjects. Example: "${pluralSubjects[i]} ${pluralVerbs[i]} every day."`
    });
    index += 1;
  }

  const tenses = [
    ['present', 'I walk to school.'],
    ['past', 'I walked to school yesterday.'],
    ['future', 'I will walk to school tomorrow.'],
    ['present continuous', 'I am walking to school now.'],
    ['present perfect', 'I have walked to school many times.']
  ];

  for (const [tense, example] of tenses) {
    lessons.push({
      id: `eng-tense-${index}`,
      topic: 'english-grammar',
      content: `Verb tense rule: keep tense consistent unless time changes. ${tense} example: "${example}"`
    });
    index += 1;
  }

  const punctuationRules = [
    'Use a period to end statements.',
    'Use a question mark for direct questions.',
    'Use commas to separate items in a list.',
    'Use apostrophes for contractions and possession.',
    'Use quotation marks around direct speech.'
  ];

  for (const rule of punctuationRules) {
    lessons.push({
      id: `eng-punct-${index}`,
      topic: 'english-grammar',
      content: `Punctuation rule: ${rule}`
    });
    index += 1;
  }

  const sentencePatterns = [
    ['simple', 'Subject + verb + object'],
    ['compound', 'Independent clause + conjunction + independent clause'],
    ['complex', 'Dependent clause + independent clause'],
    ['question', 'Auxiliary verb + subject + main verb?'],
    ['imperative', 'Base verb + object']
  ];

  for (const [kind, structure] of sentencePatterns) {
    lessons.push({
      id: `eng-structure-${index}`,
      topic: 'english-grammar',
      content: `Sentence structure (${kind}): ${structure}.`
    });
    index += 1;
  }

  const transitions = ['however', 'therefore', 'meanwhile', 'for example', 'in addition'];
  for (const word of transitions) {
    lessons.push({
      id: `eng-cohesion-${index}`,
      topic: 'english-writing',
      content: `Use transition words like "${word}" to connect ideas clearly between sentences.`
    });
    index += 1;
  }

  while (lessons.length < 120) {
    const n = lessons.length + 1;
    lessons.push({
      id: `eng-core-${n}`,
      topic: n % 2 === 0 ? 'english-grammar' : 'english-writing',
      content: `English practice rule ${n}: write clear sentences with correct capitalization, punctuation, and verb forms.`
    });
  }

  return lessons;
}

function buildMathLessons() {
  const lessons = [];

  let index = 1;

  const arithmeticRules = [
    'Addition combines values: a + b.',
    'Subtraction finds difference: a - b.',
    'Multiplication repeats addition: a * b.',
    'Division splits quantities: a / b where b != 0.',
    'Order of operations: parentheses, exponents, multiplication/division, addition/subtraction.'
  ];

  for (const rule of arithmeticRules) {
    lessons.push({
      id: `math-arith-${index}`,
      topic: 'math-basics',
      content: `Arithmetic rule: ${rule}`
    });
    index += 1;
  }

  const fractionExamples = [
    '1/2 = 0.5',
    '3/4 = 0.75',
    '2/5 = 0.4',
    '5/8 = 0.625',
    '7/10 = 0.7'
  ];

  for (const example of fractionExamples) {
    lessons.push({
      id: `math-frac-${index}`,
      topic: 'math-fractions',
      content: `Fraction-decimal relation: ${example}.`
    });
    index += 1;
  }

  const linearSamples = [
    ['2x+4=10', 'x=3'],
    ['3x-6=9', 'x=5'],
    ['5x+5=30', 'x=5'],
    ['4x-8=0', 'x=2'],
    ['7x+14=35', 'x=3']
  ];

  for (const [equation, answer] of linearSamples) {
    lessons.push({
      id: `math-linear-${index}`,
      topic: 'math-algebra',
      content: `Linear equation example: ${equation}, so ${answer}. Isolate x by inverse operations.`
    });
    index += 1;
  }

  const geometryRules = [
    'Rectangle area = length * width.',
    'Triangle area = (base * height) / 2.',
    'Circle area = pi * r^2.',
    'Circle circumference = 2 * pi * r.',
    'Pythagorean theorem: a^2 + b^2 = c^2.'
  ];

  for (const rule of geometryRules) {
    lessons.push({
      id: `math-geo-${index}`,
      topic: 'math-geometry',
      content: `Geometry rule: ${rule}`
    });
    index += 1;
  }

  const percentages = [
    '10% of 50 is 5',
    '25% of 80 is 20',
    '50% of 44 is 22',
    '75% of 200 is 150',
    '5% of 300 is 15'
  ];

  for (const sample of percentages) {
    lessons.push({
      id: `math-percent-${index}`,
      topic: 'math-percentages',
      content: `Percentage example: ${sample}.`
    });
    index += 1;
  }

  while (lessons.length < 120) {
    const n = lessons.length + 1;
    lessons.push({
      id: `math-core-${n}`,
      topic: n % 2 === 0 ? 'math-algebra' : 'math-basics',
      content: `Math practice rule ${n}: solve step-by-step, verify operations, and check the final answer for reasonableness.`
    });
  }

  return lessons;
}

function buildAllLessons() {
  const lessons = [...buildEnglishLessons(), ...buildMathLessons()];
  return uniqueById(lessons);
}

async function teachViaApi({ apiBaseUrl, lessons, chunkSize }) {
  let loadedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < lessons.length; index += chunkSize) {
    const chunk = lessons.slice(index, index + chunkSize);
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
  const chunkSize = Number(getArg('--chunk', '40'));
  const outFile = path.resolve(getArg('--out', './data/starter-lessons.json'));

  const lessons = buildAllLessons();

  console.log(`Prepared ${lessons.length} lessons (English + Math).`);

  if (mode === 'api' || mode === 'both') {
    try {
      const apiResult = await teachViaApi({ apiBaseUrl, lessons, chunkSize });
      console.log(
        `API teaching complete: loaded=${apiResult.loadedCount}, skipped=${apiResult.skippedCount}`
      );
    } catch (error) {
      console.warn(`API teaching failed: ${error.message}`);
      if (mode === 'api') {
        process.exitCode = 1;
      }
    }
  }

  if (mode === 'file' || mode === 'both') {
    const fileResult = teachViaFile({ filePath: outFile, lessons });
    console.log(
      `File teaching complete: added=${fileResult.added}, totalLessonsInFile=${fileResult.total}, file=${outFile}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
