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

function codePointHex(char) {
  return `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

function escapeForLesson(char) {
  if (char === ' ') return '[space]';
  if (char === '\\') return '[backslash]';
  if (char === '`') return '[backtick]';
  return char;
}

function buildEmojiLessons() {
  const lessons = [];

  const emojiSet = [
    ['😀', 'grinning face', 'positive mood, friendliness, general happiness'],
    ['😄', 'grinning face with smiling eyes', 'joy, cheerful excitement'],
    ['🙂', 'slightly smiling face', 'polite friendliness or mild positivity'],
    ['😉', 'winking face', 'playful tone, joke, or light sarcasm'],
    ['😂', 'face with tears of joy', 'strong laughter; something is very funny'],
    ['🤣', 'rolling on the floor laughing', 'extreme laughter and amusement'],
    ['😊', 'smiling face with smiling eyes', 'warmth, gratitude, and kindness'],
    ['😇', 'smiling face with halo', 'innocent tone or jokingly acting angelic'],
    ['😍', 'smiling face with heart-eyes', 'love, admiration, intense liking'],
    ['🥰', 'smiling face with hearts', 'affection, feeling loved, tenderness'],
    ['😘', 'face blowing a kiss', 'affection, thanks, or friendly love'],
    ['😎', 'smiling face with sunglasses', 'confidence, coolness, relaxed vibe'],
    ['🤔', 'thinking face', 'consideration, uncertainty, evaluating ideas'],
    ['🧐', 'face with monocle', 'careful inspection or skepticism'],
    ['🤯', 'exploding head', 'mind blown by surprise or complexity'],
    ['😮', 'face with open mouth', 'surprise or amazement'],
    ['😢', 'crying face', 'sadness, disappointment, emotional pain'],
    ['😭', 'loudly crying face', 'intense sadness, overwhelming emotion'],
    ['😡', 'pouting face', 'anger, frustration, disapproval'],
    ['😤', 'face with steam from nose', 'determination, annoyance, or triumph'],
    ['😱', 'face screaming in fear', 'shock, fear, panic, major surprise'],
    ['😬', 'grimacing face', 'awkwardness, discomfort, nervous tension'],
    ['😅', 'grinning face with sweat', 'relief after stress or nervous laughter'],
    ['🙃', 'upside-down face', 'goofiness, irony, playful confusion'],
    ['😴', 'sleeping face', 'sleepiness, boredom, or exhaustion'],
    ['🤗', 'hugging face', 'support, warmth, comfort, welcome'],
    ['🤝', 'handshake', 'agreement, deal, collaboration'],
    ['👍', 'thumbs up', 'approval, yes, good job'],
    ['👎', 'thumbs down', 'disapproval, no, poor quality'],
    ['👏', 'clapping hands', 'praise, congratulations, appreciation'],
    ['🙏', 'folded hands', 'thanks, prayer, request, respect'],
    ['💪', 'flexed biceps', 'strength, effort, motivation'],
    ['🔥', 'fire', 'excellent, trending, exciting, intense'],
    ['✨', 'sparkles', 'magic, emphasis, excitement, polish'],
    ['🎉', 'party popper', 'celebration, achievement, milestone'],
    ['✅', 'check mark button', 'completed, correct, approved'],
    ['❌', 'cross mark', 'incorrect, rejected, canceled'],
    ['⚠️', 'warning sign', 'caution, potential issue, attention needed'],
    ['💡', 'light bulb', 'idea, insight, suggestion'],
    ['📚', 'books', 'learning, study, education'],
    ['🧠', 'brain', 'thinking, intelligence, cognition'],
    ['💯', 'hundred points', 'perfect, strongly agree, excellent'],
    ['❤️', 'red heart', 'love, care, emotional support'],
    ['💔', 'broken heart', 'heartbreak, emotional hurt, sadness'],
    ['🌍', 'globe showing Europe-Africa', 'global topics, world context'],
    ['🕒', 'three o’clock', 'time awareness, schedule reminder'],
    ['📈', 'chart increasing', 'growth, improvement, progress'],
    ['📉', 'chart decreasing', 'decline, decrease, warning trend'],
    ['💬', 'speech balloon', 'conversation, messaging, discussion'],
    ['🔍', 'magnifying glass tilted left', 'search, analysis, investigation']
  ];

  let index = 1;
  for (const [emoji, name, meaning] of emojiSet) {
    lessons.push({
      id: `emoji-meaning-${index}`,
      topic: 'emoji-meanings',
      content: `Emoji ${emoji} (${name}, ${codePointHex(emoji)}) usually means ${meaning}. Context matters: the same emoji can shift tone depending on the sentence and audience.`
    });
    index += 1;
  }

  const communicationRules = [
    'Emojis add tone that plain text may not convey, especially in short messages.',
    'A single emoji can change intent: “okay” vs “okay 👍” feel different.',
    'Use emojis carefully in formal writing; overuse can reduce clarity.',
    'Different cultures and communities may interpret the same emoji differently.',
    'In professional settings, prefer clear words first, then optional emoji tone markers.',
    'Emoji sequences can imply narrative, for example 📚➡️🧠 suggests studying leads to learning.',
    'Ambiguous emoji messages should be clarified with text to avoid misunderstanding.',
    'Some emoji render differently by platform, so appearance can vary between devices.',
    'Skin tone and gender modifiers exist for many people emojis; choose inclusive usage.',
    'Flags and symbols can be politically sensitive; use them with context and care.'
  ];

  for (let i = 0; i < communicationRules.length; i += 1) {
    lessons.push({
      id: `emoji-usage-${i + 1}`,
      topic: 'emoji-usage',
      content: `Emoji communication rule ${i + 1}: ${communicationRules[i]}`
    });
  }

  return lessons;
}

function buildAsciiLessons() {
  const lessons = [];

  const controlCodes = [
    [0, 'NUL', 'null character; historically used as string terminator'],
    [7, 'BEL', 'bell/alert control code'],
    [8, 'BS', 'backspace control code'],
    [9, 'TAB', 'horizontal tab control code'],
    [10, 'LF', 'line feed/new line on Unix-like systems'],
    [13, 'CR', 'carriage return; common in Windows CRLF line endings'],
    [27, 'ESC', 'escape character used in terminal control sequences'],
    [32, 'SPACE', 'space separator between words'],
    [127, 'DEL', 'delete control code']
  ];

  for (const [code, shortName, meaning] of controlCodes) {
    lessons.push({
      id: `ascii-control-${code}`,
      topic: 'ascii-control',
      content: `ASCII code ${code} (${shortName}) is a control/special character. Meaning: ${meaning}.`
    });
  }

  for (let code = 33; code <= 126; code += 1) {
    const char = String.fromCharCode(code);
    lessons.push({
      id: `ascii-char-${code}`,
      topic: 'ascii-printable',
      content: `ASCII printable character ${escapeForLesson(char)} has decimal code ${code} and hexadecimal 0x${code.toString(16).toUpperCase().padStart(2, '0')}.`
    });
  }

  const rangeRules = [
    ['48-57', 'digits 0-9'],
    ['65-90', 'uppercase letters A-Z'],
    ['97-122', 'lowercase letters a-z'],
    ['33-47', 'common punctuation and symbols group 1'],
    ['58-64', 'common punctuation and symbols group 2'],
    ['91-96', 'brackets, backslash, caret, underscore, grave accent'],
    ['123-126', 'braces, vertical bar, tilde']
  ];

  for (let i = 0; i < rangeRules.length; i += 1) {
    const [range, meaning] = rangeRules[i];
    lessons.push({
      id: `ascii-range-${i + 1}`,
      topic: 'ascii-structure',
      content: `ASCII range ${range} represents ${meaning}. Learning ranges helps with parsing text and validating character classes.`
    });
  }

  lessons.push({
    id: 'ascii-overview-1',
    topic: 'ascii-structure',
    content: 'ASCII is a 7-bit character encoding standard with 128 codes from 0 to 127. It defines control characters and printable symbols used in early computing and remains foundational today.'
  });

  lessons.push({
    id: 'ascii-overview-2',
    topic: 'ascii-vs-unicode',
    content: 'Unicode preserves ASCII compatibility: all ASCII characters keep the same code values in Unicode. This allows modern systems to read legacy ASCII text correctly.'
  });

  return lessons;
}

function buildUnicodeLessons() {
  const lessons = [];

  const scriptExamples = [
    ['Latin', 'A', 'U+0041'],
    ['Greek', 'Ω', 'U+03A9'],
    ['Cyrillic', 'Ж', 'U+0416'],
    ['Hebrew', 'ש', 'U+05E9'],
    ['Arabic', 'ع', 'U+0639'],
    ['Devanagari', 'क', 'U+0915'],
    ['Bengali', 'অ', 'U+0985'],
    ['Thai', 'ก', 'U+0E01'],
    ['Chinese Han', '漢', 'U+6F22'],
    ['Japanese Hiragana', 'あ', 'U+3042'],
    ['Japanese Katakana', 'ア', 'U+30A2'],
    ['Korean Hangul', '한', 'U+D55C']
  ];

  for (let i = 0; i < scriptExamples.length; i += 1) {
    const [script, sample, cp] = scriptExamples[i];
    lessons.push({
      id: `unicode-script-${i + 1}`,
      topic: 'unicode-scripts',
      content: `Unicode supports the ${script} script. Example character: ${sample} (${cp}).`
    });
  }

  const conceptLessons = [
    'Unicode is a universal character standard that assigns code points to characters from many writing systems.',
    'A code point is written as U+XXXX (or longer), such as U+1F600 for 😀.',
    'UTF-8 is a variable-length encoding that can represent every Unicode code point and is dominant on the web.',
    'UTF-16 is another Unicode encoding used internally by some platforms and programming environments.',
    'A grapheme cluster is what users see as one character, but it can be multiple code points.',
    'Combining marks modify base letters, such as e + combining acute accent to form é.',
    'Unicode normalization (NFC, NFD, NFKC, NFKD) helps compare text consistently.',
    'Zero-width joiner (ZWJ, U+200D) connects emoji into composite forms like family sequences.',
    'Variation selectors can request emoji-style or text-style presentation for some symbols.',
    'Right-to-left scripts require bidi handling to display text in the correct visual order.',
    'Some visually similar characters are different code points, which can affect security and validation.',
    'Case folding and locale-aware casing are important for robust Unicode text matching.',
    'Unicode includes mathematical symbols, currency symbols, arrows, and technical notation.',
    'Unicode includes Braille patterns and accessibility-related symbol sets.',
    'Not all fonts cover all Unicode blocks; missing glyphs may appear as tofu boxes.'
  ];

  for (let i = 0; i < conceptLessons.length; i += 1) {
    lessons.push({
      id: `unicode-concept-${i + 1}`,
      topic: 'unicode-concepts',
      content: `Unicode concept ${i + 1}: ${conceptLessons[i]}`
    });
  }

  const symbolExamples = [
    ['∞', 'infinity symbol', 'U+221E'],
    ['≈', 'approximately equal', 'U+2248'],
    ['≠', 'not equal', 'U+2260'],
    ['≤', 'less-than or equal', 'U+2264'],
    ['≥', 'greater-than or equal', 'U+2265'],
    ['€', 'euro sign', 'U+20AC'],
    ['¥', 'yen sign', 'U+00A5'],
    ['₹', 'indian rupee sign', 'U+20B9'],
    ['©', 'copyright sign', 'U+00A9'],
    ['™', 'trade mark sign', 'U+2122'],
    ['✓', 'check mark', 'U+2713'],
    ['✈', 'airplane symbol', 'U+2708']
  ];

  for (let i = 0; i < symbolExamples.length; i += 1) {
    const [char, meaning, cp] = symbolExamples[i];
    lessons.push({
      id: `unicode-symbol-${i + 1}`,
      topic: 'unicode-symbols',
      content: `Unicode symbol ${char} (${cp}) means ${meaning}. Symbols extend expressiveness beyond basic ASCII punctuation.`
    });
  }

  return lessons;
}

function buildAllLessons() {
  const lessons = [
    ...buildEmojiLessons(),
    ...buildAsciiLessons(),
    ...buildUnicodeLessons()
  ];
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

  console.log(`Prepared ${lessons.length} lessons (Emojis + ASCII + Unicode).`);

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
