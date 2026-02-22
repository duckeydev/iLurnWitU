#!/usr/bin/env node
/*
  scripts/teach-pdf.js
  - Reads one PDF file or all PDFs in a folder
  - Extracts text using `pdf-parse`
  - Chunks text into manageable pieces and optionally POSTs to /api/learn/facts

  Usage examples:
    node scripts/teach-pdf.js --file ./docs/example.pdf --api http://localhost:3000 --chunkChars 1200 --post true
    node scripts/teach-pdf.js --dir ./pdfs --api http://localhost:3000 --chunkChars 1200 --onlyOne false
*/

const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const argv = require('process').argv.slice(2);
function getArg(name, fallback) {
  const ix = argv.indexOf('--' + name);
  if (ix === -1) return fallback;
  const val = argv[ix + 1];
  if (!val || val.startsWith('--')) return true;
  return val;
}

const file = getArg('file', null);
const dir = getArg('dir', null);
const api = getArg('api', 'http://localhost:3000');
const chunkChars = parseInt(getArg('chunkChars', '1200'), 10);
const onlyOne = String(getArg('onlyOne', 'true')) !== 'false';
const doPost = String(getArg('post', 'true')) !== 'false';

if (!file && !dir) {
  console.error('Specify --file <path> or --dir <folder>');
  process.exit(2);
}

async function extractTextFromPdf(buffer) {
  const data = await pdf(buffer);
  return data.text || '';
}

function chunkText(text, maxChars) {
  const paragraphs = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paragraphs) {
    if ((cur + '\n\n' + p).length <= maxChars) {
      cur = cur ? cur + '\n\n' + p : p;
    } else {
      if (cur) chunks.push(cur);
      if (p.length > maxChars) {
        // hard-split long paragraph
        for (let i = 0; i < p.length; i += maxChars) {
          chunks.push(p.slice(i, i + maxChars));
        }
        cur = '';
      } else {
        cur = p;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function postFacts(facts) {
  if (!doPost) return {ok:false, msg:'post disabled', count: facts.length};
  const url = (api.endsWith('/') ? api.slice(0, -1) : api) + '/api/learn/facts';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({facts}),
    });
    const body = await res.text();
    return {ok: res.ok, status: res.status, body};
  } catch (err) {
    return {ok:false, err: String(err)};
  }
}

async function processFile(filePath) {
  console.log('Processing', filePath);
  const buf = fs.readFileSync(filePath);
  const text = await extractTextFromPdf(buf);
  if (!text || !text.trim()) {
    console.warn('No text extracted for', filePath);
    return {file:filePath, facts:0};
  }
  const chunks = chunkText(text, chunkChars);
  const facts = chunks.map((c, i) => ({
    source: 'pdf',
    title: path.basename(filePath),
    path: filePath,
    content: c,
    sourceId: `${path.basename(filePath)}::${i}`
  }));
  console.log(` -> extracted ${chunks.length} chunks`);
  const postRes = await postFacts(facts);
  console.log(' -> post result', postRes && (postRes.ok ? `ok ${postRes.status}` : postRes));
  return {file:filePath, facts: facts.length, postRes};
}

async function main() {
  const files = [];
  if (file) {
    if (!fs.existsSync(file)) { console.error('file not found', file); process.exit(2); }
    files.push(file);
  }
  if (dir) {
    if (!fs.existsSync(dir)) { console.error('dir not found', dir); process.exit(2); }
    const ents = fs.readdirSync(dir);
    for (const e of ents) {
      const full = path.join(dir, e);
      if (fs.statSync(full).isFile() && full.toLowerCase().endsWith('.pdf')) files.push(full);
    }
  }
  if (!files.length) { console.log('No PDF files found'); return; }
  console.log(`Found ${files.length} pdf(s); onlyOne=${onlyOne}; post=${doPost}`);
  for (let i=0;i<files.length;i++) {
    const f = files[i];
    try {
      await processFile(f);
    } catch (err) {
      console.error('Error processing', f, err);
    }
    if (onlyOne) break;
  }
}

main().catch(err => { console.error(err); process.exit(1); });
