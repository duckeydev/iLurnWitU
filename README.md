# iLurnWitU - Learning Chatbot (Node.js)

This project is a chatbot that starts from scratch and learns from conversations over time.

## Features

- Incremental learning with persistent memory (`data/memory.json`)
- Learns token transitions and recalls similar past conversations
- Local neural-like memory layer (hashed vector encoder + online prototype training) for pattern-based reply recall
- Continuous background training that keeps consolidating old interactions
- Concept graph + association graph for broader topic understanding
- Website URL learning (paste URLs and the bot ingests page content)
- Document URL learning for PDF, Word (`.docx`, `.doc`), and PowerPoint (`.pptx`, `.ppt`)
- Mentor AI review using Hack Club AI chat completions for right/wrong guidance
- If mentor marks a recalled answer as clearly wrong, the bot purges that bad memory and replaces it with corrected content
- Supports explicit memory teaching using:
  - `remember that <fact>`
- Simple frontend chat UI
- Pretty logs with `pino-pretty`
- Debug logs with `debug` namespaces (`app:*`)

## Run

```bash
npm install
npm run dev
```

Open: `http://localhost:3000`

## Environment Variables

- `HACK_CLUB_AI_API_KEY` (required for mentor AI guidance)
- `HACK_CLUB_AI_MODEL` (optional, default: `qwen/qwen3-32b`)
- `HACK_CLUB_AI_BASE_URL` (optional, default: `https://ai.hackclub.com/proxy/v1`)
- `MENTOR_ENABLED` (optional, default: `true`; set `false` to disable mentor by default)
- `ESSAY_TEMPERATURE` (optional, `0.0`-`1.0`, default `0.65`; higher = more variation/creativity in essays)
- `WEB_RECURSE_DEPTH` (optional, default: `0`; set `1+` to follow links recursively)
- `WEB_MAX_PAGES` (optional, default: `3`; use `0`, `-1`, or `unlimited` for no page limit)
- `WEB_MAX_HREFS_PER_PAGE` (optional, default: `12`; use `0`, `-1`, or `unlimited` for no href limit)
- `WEB_MAX_SEED_URLS` (optional, default: `3`; use `0`, `-1`, or `unlimited` for no seed URL limit)
- `WEB_SUMMARY_MAX_CHARS` (optional, default: `1200`; use `0`, `-1`, or `unlimited` for unlimited summary size)
- `WEB_SCRAPE_MAX_CHARS` (optional, default: `unlimited`)
- `WEB_FETCH_TIMEOUT_MS` (optional, default: `12000`)
- `WEB_FETCH_RETRIES` (optional, default: `2`)
- `NEURAL_PRIMARY_ENABLED` (optional, default: `true`; when enabled the bot uses Hack Club AI as the primary reply generator and falls back to local symbolic logic on failure)
- `NEURAL_TEMPERATURE` (optional, `0.0`-`1.0`, default: `0.3`)
- `NEURAL_IMPORT_ON_START` (optional, default: `false`; when `true`, imports all memory into local neural prototypes after server startup)
- `MEMORY_SEARCH_WINDOW` (optional, default: `1500`; limits how many most-recent interactions are scanned for memory recall, lower is faster)

Note: PDF URL learning uses Hack Club OCR (`/proxy/v1/ocr`) and needs `HACK_CLUB_AI_API_KEY`.
Word and PowerPoint URLs use the same pipeline (Hack Club OCR/parser first, then local fallback for `.docx`/`.pptx`).
Mentor can be toggled live in the UI per request and also defaulted with `.env`.
Essay prompts can also include `temperature 0.9` or words like `creative` / `formal` to adjust writing style.

## Debug Mode

```bash
npm run debug
```

This enables:

- `LOG_LEVEL=debug`
- `DEBUG=app:*`
- Structured mentor logs (`mentor_review`, `mentor_applied_correction`) in server output

## Continuous Learning Notes

- The bot learns from every user turn immediately.
- A background trainer runs every 5 seconds and re-trains on stored interactions.
- More diverse and high-quality conversations improve capability across topics.
- Website sources are fetched and ingested into concept/token memory when users share URLs.
- Mentor AI can revise weak replies and provide correction feedback.
- Starter lessons are loaded from `data/starter-lessons.json` at startup (one-time per lesson `id`).

## Starter Teaching File

- Edit `data/starter-lessons.json` to pre-teach the bot core knowledge.
- Each item needs: `id`, `topic`, and `content`.
- New lesson `id`s are imported once; existing `id`s are skipped on restart.

## Bulk English + Math Teaching Script

- Teach via API + file at once: `npm run teach:english-math`
- Teach only into file: `npm run teach:english-math:file`
- Teach only into running server API: `npm run teach:english-math:api`

Advanced usage:

- `node scripts/teach-english-math.js --mode both --api http://localhost:3000 --chunk 40 --out ./data/starter-lessons.json`

## Bulk Emoji + ASCII + Unicode Teaching Script

- Teach via API + file at once: `npm run teach:emoji-unicode`
- Teach only into file: `npm run teach:emoji-unicode:file`
- Teach only into running server API: `npm run teach:emoji-unicode:api`

Advanced usage:

- `node scripts/teach-emojis-unicode.js --mode both --api http://localhost:3000 --chunk 40 --out ./data/starter-lessons.json`

## Bulk Hack Club AI Teaching Script

- Teach a lot of lessons via Hack Club AI into API + file: `npm run teach:hackclub`
- Teach only into file: `npm run teach:hackclub:file`
- Teach only into running server API: `npm run teach:hackclub:api`

Advanced usage:

- `node scripts/teach-hackclub-bulk.js --mode both --batches 30 --per-batch 25 --delay-ms 700 --retries 3 --api http://localhost:3000 --chunk 40 --out ./data/starter-lessons.json`
- `node scripts/teach-hackclub-bulk.js --mode both --batches 30 --per-batch 25 --topics "physics,chemistry,biology,programming,writing" --delay-ms 700 --retries 3 --api http://localhost:3000 --chunk 40 --out ./data/starter-lessons.json`

Notes:

- Requires `HACK_CLUB_AI_API_KEY` in your environment (or pass `--key <token>`).
- Default target is about 600 generated lessons (`25` batches × `24` per batch), deduplicated before teaching.
- Use `--topics` with comma-separated values to focus curriculum (defaults to a broad mixed curriculum).
- Script now logs structured progress for batch start/success/retry and final ingest totals.

## API

- `POST /api/chat`
  - body: `{ "message": "hello", "sessionId": "optional", "urls": ["https://example.com"], "webOptions": { "recurseDepth": 1, "maxPages": 10, "summaryMaxChars": "unlimited", "scrapeMaxChars": "unlimited", "neuralEnabled": true } }`
- `POST /api/chat/stream`
  - body: `{ "message": "hello", "sessionId": "optional", "urls": ["https://example.com"], "webOptions": { "recurseDepth": 1, "maxPages": 10, "neuralEnabled": true } }`
  - returns SSE events: `stage`, `reasoning`, `token`, `done`
- `POST /api/learn/lesson`
  - body (single): `{ "lesson": { "id": "eng-001", "topic": "english", "content": "Use subject-verb agreement." } }`
  - body (bulk): `{ "lessons": [{ "id": "math-001", "topic": "math", "content": "2+2=4" }] }`
- `GET /api/stats`
- `GET /api/neural/graph?limit=20&minEdge=0.55`
  - returns local neural prototype nodes and cosine-similarity edges for visualization
- `POST /api/neural/import-all`
  - rebuilds local neural prototypes from all stored memory (`interactions`, `responseBank`, `learnedFacts`, `webKnowledge`)
- `GET /api/health`

## Teach From PDF

- `scripts/teach-pdf.js` reads one PDF or all PDFs in a folder, extracts text and splits it into chunks, and posts those chunks to the running server's `/api/learn/facts` endpoint.

Usage examples:

```
node scripts/teach-pdf.js --file ./docs/example.pdf --api http://localhost:3000 --chunkChars 1200 --post true

node scripts/teach-pdf.js --dir ./pdfs --api http://localhost:3000 --chunkChars 1200 --onlyOne false --post true
```

- `--file <path>` : process a single PDF
- `--dir <folder>` : process all `*.pdf` files in the folder
- `--api <url>` : server base URL (default `http://localhost:3000`)
- `--chunkChars <n>` : target chunk size in characters (default `1200`)
- `--onlyOne <true|false>` : when processing a folder, stop after the first file if `true` (default `true`)
- `--post <true|false>` : actually POST facts to the server (default `true`). Use `--post false` to only preview extraction.

Note: this script depends on `pdf-parse` (already in `package.json`). Run `npm install` if you haven't installed dependencies yet.
