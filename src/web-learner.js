const { lookup } = require('dns').promises;
const { URL } = require('url');
const createDebug = require('debug');
const pdfParse = require('pdf-parse');
const JSZip = require('jszip');

const debug = createDebug('app:web');

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeLayoutBlocks(html) {
  return String(html || '')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
}

function extractPreferredContentHtml(html) {
  const source = String(html || '');
  if (!source) {
    return source;
  }

  const candidates = [];
  const patterns = [
    /<main\b[^>]*>[\s\S]*?<\/main>/gi,
    /<article\b[^>]*>[\s\S]*?<\/article>/gi,
    /<div\b[^>]*id=["'][^"']*mw-content-text[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div\b[^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div\b[^>]*role=["']main["'][^>]*>[\s\S]*?<\/div>/gi
  ];

  for (const pattern of patterns) {
    const matches = source.match(pattern) || [];
    for (const match of matches) {
      candidates.push(match);
    }
  }

  if (!candidates.length) {
    return source;
  }

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  if (parts[0] === 10 || parts[0] === 127) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  return false;
}

function isPrivateIpv6(ip) {
  const normalized = String(ip || '').toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

class WebLearner {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.HACK_CLUB_AI_API_KEY || process.env.HACKCLUB_AI_API_KEY;
    this.baseUrl = options.baseUrl || process.env.HACK_CLUB_AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1';
    this.chatModel = options.chatModel || process.env.HACK_CLUB_AI_MODEL || 'qwen/qwen3-32b';

    this.defaultCrawl = {
      recurseDepth: this.parseIntegerOrFallback(process.env.WEB_RECURSE_DEPTH, 0),
      maxPages: this.parseNullableIntegerOrFallback(process.env.WEB_MAX_PAGES, null),
      maxHrefsPerPage: this.parseIntegerOrFallback(process.env.WEB_MAX_HREFS_PER_PAGE, 12),
      maxSeedUrls: this.parseIntegerOrFallback(process.env.WEB_MAX_SEED_URLS, 3),
      maxRecursiveUrls: this.parseIntegerOrFallback(process.env.WEB_MAX_RECURSIVE_URLS, 20),
      sameOriginOnly: this.parseBooleanOrFallback(process.env.WEB_SAME_ORIGIN_ONLY, true),
      summaryMaxChars: this.parseNullableIntegerOrFallback(process.env.WEB_SUMMARY_MAX_CHARS, null),
      scrapeMaxChars: this.parseNullableIntegerOrFallback(process.env.WEB_SCRAPE_MAX_CHARS, null),
      fetchTimeoutMs: this.parseIntegerOrFallback(process.env.WEB_FETCH_TIMEOUT_MS, 12000),
      fetchRetries: this.parseIntegerOrFallback(process.env.WEB_FETCH_RETRIES, 2)
    };

    this.defaultSearch = {
      enabled: this.parseBooleanOrFallback(process.env.WEB_SEARCH_ENABLED, true),
      maxResults: this.parseIntegerOrFallback(process.env.WEB_SEARCH_MAX_RESULTS, 4)
    };
  }

  parseIntegerOrFallback(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.max(0, Math.floor(num));
  }

  parseNullableIntegerOrFallback(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return fallback;
    }

    const normalized = String(value).trim().toLowerCase();
    if (['0', '-1', 'unlimited', 'infinity', 'inf', 'none'].includes(normalized)) {
      return null;
    }

    const num = Number(normalized);
    if (!Number.isFinite(num)) {
      return fallback;
    }

    if (num <= 0) {
      return null;
    }

    return Math.floor(num);
  }

  parseBooleanOrFallback(value, fallback) {
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

  normalizeCrawlOptions(options = {}) {
    const recurseDepth = this.parseIntegerOrFallback(options.recurseDepth, this.defaultCrawl.recurseDepth);
    const maxPages = this.parseNullableIntegerOrFallback(options.maxPages, this.defaultCrawl.maxPages);
    const maxHrefsPerPage = this.parseNullableIntegerOrFallback(
      options.maxHrefsPerPage,
      this.defaultCrawl.maxHrefsPerPage
    );
    const maxSeedUrls = this.parseNullableIntegerOrFallback(options.maxSeedUrls, this.defaultCrawl.maxSeedUrls);
    const maxRecursiveUrls = this.parseNullableIntegerOrFallback(
      options.maxRecursiveUrls,
      this.defaultCrawl.maxRecursiveUrls
    );
    const sameOriginOnly = this.parseBooleanOrFallback(options.sameOriginOnly, this.defaultCrawl.sameOriginOnly);
    const summaryMaxChars = this.parseNullableIntegerOrFallback(
      options.summaryMaxChars,
      this.defaultCrawl.summaryMaxChars
    );
    const scrapeMaxChars = this.parseNullableIntegerOrFallback(options.scrapeMaxChars, this.defaultCrawl.scrapeMaxChars);
    const fetchTimeoutMs = this.parseIntegerOrFallback(options.fetchTimeoutMs, this.defaultCrawl.fetchTimeoutMs);
    const fetchRetries = this.parseIntegerOrFallback(options.fetchRetries, this.defaultCrawl.fetchRetries);

    return {
      recurseDepth,
      maxPages,
      maxHrefsPerPage,
      maxSeedUrls,
      maxRecursiveUrls,
      sameOriginOnly,
      summaryMaxChars,
      scrapeMaxChars,
      fetchTimeoutMs,
      fetchRetries
    };
  }

  normalizeSearchOptions(options = {}) {
    const enabled = this.parseBooleanOrFallback(options.enabled, this.defaultSearch.enabled);
    const maxResults = this.parseIntegerOrFallback(options.maxResults, this.defaultSearch.maxResults);

    return {
      enabled,
      maxResults: Math.max(1, maxResults)
    };
  }

  resolveDuckDuckGoHref(href) {
    const raw = String(href || '').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = new URL(raw, 'https://duckduckgo.com');
      if ((parsed.pathname === '/l/' || parsed.pathname === '/l') && parsed.searchParams.has('uddg')) {
        return decodeURIComponent(parsed.searchParams.get('uddg'));
      }

      if (parsed.pathname === '/lite/') {
        return null;
      }

      if (!/^https?:$/i.test(parsed.protocol)) {
        return null;
      }

      if (/duckduckgo\.com$/i.test(parsed.hostname)) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  extractSearchUrlsFromHtml(html, maxResults) {
    const links = [];
    const seen = new Set();
    const pattern = /<a\s[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) !== null) {
      let href = match[2];
      if (href.startsWith('/l/?uddg=')) {
        href = decodeURIComponent(href.split('uddg=')[1].split('&')[0]);
      }
      const resolved = this.resolveDuckDuckGoHref(href);
      if (!resolved || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      links.push(resolved);
      if (links.length >= maxResults) {
        break;
      }
    }

    return links;
  }

  async searchWeb(query, options = {}) {
    const searchOptions = this.normalizeSearchOptions(options);
    if (!searchOptions.enabled) {
      return {
        ok: false,
        reason: 'search_disabled',
        urls: []
      };
    }

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      return {
        ok: false,
        reason: 'empty_query',
        urls: []
      };
    }

    const normalizedQuery = this.normalizeSearchQuery(cleanQuery);
    const endpoint = `https://lite.duckduckgo.com/lite/`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://lite.duckduckgo.com',
          'Referer': 'https://lite.duckduckgo.com/'
        },
        body: `q=${encodeURIComponent(normalizedQuery)}`
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: `search_http_${response.status}`,
          urls: []
        };
      }

      const html = await response.text();
      require('fs').writeFileSync('debug-ddg-server.html', html);
      const urls = this.extractSearchUrlsFromHtml(html, searchOptions.maxResults);

      if (!urls.length) {
        const wikiFallback = await this.searchWikipedia(normalizedQuery, searchOptions.maxResults);
        if (wikiFallback.length) {
          return {
            ok: true,
            reason: 'ok',
            provider: 'wikipedia',
            query: cleanQuery,
            urls: wikiFallback
          };
        }
      }

      return {
        ok: urls.length > 0,
        reason: urls.length ? 'ok' : 'no_results',
        provider: 'duckduckgo',
        query: normalizedQuery,
        urls
      };
    } catch (error) {
      debug('Web search failed query=%s: %O', cleanQuery, error);
      return {
        ok: false,
        reason: 'search_failed',
        urls: []
      };
    }
  }

  normalizeSearchQuery(query) {
    const cleaned = String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\b(what is|whats|what s|tell me about|about|explain|define|learn about|learn)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || String(query || '').trim();
  }

  async searchWikipedia(query, maxResults = 4) {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
      query
    )}&limit=${Math.max(1, maxResults)}&namespace=0&format=json&origin=*`;

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)',
          Accept: 'application/json'
        }
      });
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const urls = Array.isArray(data?.[3]) ? data[3] : [];
      return urls.filter((item) => typeof item === 'string' && item.startsWith('http')).slice(0, maxResults);
    } catch (error) {
      debug('Wikipedia search fallback failed query=%s: %O', query, error);
      return [];
    }
  }

  buildWikipediaGuessUrl(query) {
    const slug = String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s/g, '_');

    if (!slug) {
      return null;
    }

    return `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}`;
  }

  getDocumentKind(urlString, contentType) {
    const normalizedType = String(contentType || '').toLowerCase();
    const normalizedUrl = String(urlString || '').toLowerCase();

    if (normalizedType.includes('application/pdf') || normalizedUrl.endsWith('.pdf')) {
      return 'pdf';
    }
    if (
      normalizedType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
      normalizedType.includes('application/msword') ||
      normalizedUrl.endsWith('.docx') ||
      normalizedUrl.endsWith('.doc')
    ) {
      return 'word';
    }
    if (
      normalizedType.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation') ||
      normalizedType.includes('application/vnd.ms-powerpoint') ||
      normalizedUrl.endsWith('.pptx') ||
      normalizedUrl.endsWith('.ppt')
    ) {
      return 'powerpoint';
    }

    return null;
  }

  extractUrls(message) {
    const urlRegex = /https?:\/\/[^\s)\]}>"']+/gi;
    return [...new Set(String(message || '').match(urlRegex) || [])].slice(0, 3);
  }

  async isSafeUrl(urlString) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return { safe: false, reason: 'invalid_url' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: 'unsupported_protocol' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname) || hostname.endsWith('.local')) {
      return { safe: false, reason: 'local_address_blocked' };
    }

    try {
      const addresses = await lookup(hostname, { all: true });
      for (const entry of addresses) {
        if (entry.family === 4 && isPrivateIpv4(entry.address)) {
          return { safe: false, reason: 'private_network_blocked' };
        }
        if (entry.family === 6 && isPrivateIpv6(entry.address)) {
          return { safe: false, reason: 'private_network_blocked' };
        }
      }
    } catch (error) {
      debug('DNS resolution failed for %s: %O', urlString, error);
      return { safe: false, reason: 'dns_resolution_failed' };
    }

    return { safe: true, reason: 'ok' };
  }

  summarizeText(text, maxChars = 800) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (maxChars === null) {
      return clean;
    }
    if (clean.length <= maxChars) {
      return clean;
    }

    const sliced = clean.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(' ');
    return `${(lastSpace > 200 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
  }

  extractHrefs(html, baseUrl, options = {}) {
    const maxHrefs = options.maxHrefsPerPage === null ? Number.POSITIVE_INFINITY : Number(options.maxHrefsPerPage || 0);
    if (maxHrefs <= 0) {
      return [];
    }

    const links = [];
    const seen = new Set();
    const pattern = /<a\s[^>]*href\s*=\s*(["'])(.*?)\1/gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) !== null) {
      const raw = String(match[2] || '').trim();
      if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) {
        continue;
      }

      let resolved;
      try {
        resolved = new URL(raw, baseUrl).toString();
      } catch {
        continue;
      }

      if (seen.has(resolved)) {
        continue;
      }

      seen.add(resolved);
      links.push(resolved);
      if (links.length >= maxHrefs) {
        break;
      }
    }

    return links;
  }

  cleanLowQualityText(text) {
    let cleaned = String(text || '');

    cleaned = cleaned
      .replace(/&#\d{2,6};/g, ' ')
      .replace(/\b\d{8,}\b/g, ' ')
      .replace(/jump to content/gi, ' ')
      .replace(/main menu/gi, ' ')
      .replace(/move to sidebar/gi, ' ')
      .replace(/toggle .* subsection/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }

  isWikipediaUrl(urlString) {
    try {
      const parsed = new URL(urlString);
      return /(^|\.)wikipedia\.org$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  isGitHubRepoUrl(urlString) {
    try {
      const parsed = new URL(urlString);
      if (!/(^|\.)github\.com$/i.test(parsed.hostname)) {
        return false;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts.length >= 2 && !parts[0].startsWith('settings');
    } catch {
      return false;
    }
  }

  parseGitHubRepo(urlString) {
    try {
      const parsed = new URL(urlString);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        return null;
      }
      return {
        owner: parts[0],
        repo: parts[1].replace(/\.git$/i, '')
      };
    } catch {
      return null;
    }
  }

  extractWikipediaTitle(urlString) {
    try {
      const parsed = new URL(urlString);
      const match = parsed.pathname.match(/\/wiki\/([^/?#]+)/i);
      if (!match || !match[1]) {
        return null;
      }
      return decodeURIComponent(match[1].replace(/_/g, ' ')).trim();
    } catch {
      return null;
    }
  }

  async fetchWikipediaSummary(urlString, crawlOptions) {
    const rawTitle = this.extractWikipediaTitle(urlString);
    if (!rawTitle) {
      return null;
    }

    const apiTitle = encodeURIComponent(rawTitle.replace(/\s+/g, '_'));
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${apiTitle}`;

    try {
      const response = await fetch(summaryUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)',
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const title = String(data?.title || rawTitle).trim();
      const extract = this.cleanLowQualityText(String(data?.extract || '').trim());
      if (!extract || !this.hasEnoughLanguageSignal(extract)) {
        return null;
      }

      return {
        url: urlString,
        ok: true,
        title,
        text: this.summarizeText(extract, crawlOptions.summaryMaxChars),
        chars: extract.length,
        hrefs: []
      };
    } catch (error) {
      debug('Wikipedia summary fetch failed for %s: %O', urlString, error);
      return null;
    }
  }

  async fetchWikipediaExtractFallback(urlString, crawlOptions) {
    const rawTitle = this.extractWikipediaTitle(urlString);
    if (!rawTitle) {
      return null;
    }

    const title = rawTitle.replace(/\s+/g, '_');
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&titles=${encodeURIComponent(
      title
    )}&format=json&origin=*`;

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)',
          Accept: 'application/json'
        }
      });
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const pages = Object.values(data?.query?.pages || {});
      const page = pages[0] || {};
      const extract = this.cleanLowQualityText(String(page.extract || '').trim());
      const finalTitle = this.cleanLowQualityText(String(page.title || rawTitle).trim());

      if (!extract || !this.hasEnoughLanguageSignal(extract)) {
        return null;
      }

      return {
        url: urlString,
        ok: true,
        title: finalTitle,
        text: this.summarizeText(extract, crawlOptions.summaryMaxChars),
        chars: extract.length,
        hrefs: []
      };
    } catch (error) {
      debug('Wikipedia extract fallback failed for %s: %O', urlString, error);
      return null;
    }
  }

  async fetchGitHubRepoSummary(urlString, crawlOptions) {
    const repoInfo = this.parseGitHubRepo(urlString);
    if (!repoInfo) {
      return null;
    }

    const { owner, repo } = repoInfo;
    const repoApi = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const readmeApi = `${repoApi}/readme`;

    try {
      const repoRes = await fetch(repoApi, {
        method: 'GET',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)',
          Accept: 'application/json'
        }
      });
      if (!repoRes.ok) {
        return null;
      }
      const repoData = await repoRes.json();

      let readmeText = '';
      const readmeRes = await fetch(readmeApi, {
        method: 'GET',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)',
          Accept: 'application/vnd.github.raw+json'
        }
      });

      if (readmeRes.ok) {
        readmeText = await readmeRes.text();
      }

      const cleanReadme = this.cleanGithubReadmeText(readmeText);

      const description = String(repoData?.description || '').trim();
      const language = String(repoData?.language || '').trim();
      const topics = Array.isArray(repoData?.topics) ? repoData.topics.slice(0, 8).join(', ') : '';
      const stars = Number(repoData?.stargazers_count);
      const starsText = Number.isFinite(stars) ? String(stars) : 'unknown';
      const readmeSnippet = this.summarizeText(this.cleanLowQualityText(cleanReadme), 700);

      const combined = this.cleanLowQualityText(
        `${description ? `Description: ${description}.` : ''} ${language ? `Primary language: ${language}.` : ''} ${
          topics ? `Topics: ${topics}.` : ''
        } Stars: ${starsText}. ${readmeSnippet ? `README summary: ${readmeSnippet}` : ''}`
      );

      if (!combined || !this.hasEnoughLanguageSignal(combined)) {
        return null;
      }

      return {
        url: urlString,
        ok: true,
        title: `${owner}/${repo} (GitHub Repository)`,
        text: this.summarizeText(combined, crawlOptions.summaryMaxChars),
        chars: combined.length,
        hrefs: []
      };
    } catch (error) {
      debug('GitHub summary fetch failed for %s: %O', urlString, error);
      return null;
    }
  }

  cleanGithubReadmeText(markdown) {
    let text = String(markdown || '');
    if (!text.trim()) {
      return '';
    }

    text = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/<img[^>]*>/gi, ' ')
      .replace(/<picture[\s\S]*?<\/picture>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}>+\s?/gm, '')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\|/g, ' ')
      .replace(/\[[!A-Z]+\]/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/__+/g, '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text;
  }

  hasEnoughLanguageSignal(text) {
    const sample = String(text || '');
    if (!sample) {
      return false;
    }

    const words = sample.match(/[a-zA-Z]{3,}/g) || [];
    return words.length >= 12 || sample.length >= 700;
  }

  async extractDocumentTextWithHackClubOCR(urlString, kind = 'document') {
    if (!this.apiKey) {
      return {
        ok: false,
        reason: 'pdf_needs_hackclub_api_key'
      };
    }

    const response = await fetch(`${this.baseUrl}/ocr`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        document: {
          type: 'document_url',
          document_url: urlString
        },
        table_format: 'markdown'
      })
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        reason: `ocr_http_${response.status}`,
        detail: body.slice(0, 200)
      };
    }

    const data = await response.json();
    const pageTexts = Array.isArray(data.pages)
      ? data.pages
          .map((page) => String(page.markdown || '').trim())
          .filter(Boolean)
      : [];

    const merged = this.cleanLowQualityText(pageTexts.join('\n\n'));
    if (!this.hasEnoughLanguageSignal(merged)) {
      return {
        ok: false,
        reason: 'ocr_text_low_signal'
      };
    }

    return {
      ok: true,
      title: `${kind.toUpperCase()} Document`,
      text: this.summarizeText(merged, 1600),
      chars: merged.length
    };
  }

  async extractDocumentTextWithChatParser(urlString, kind = 'document') {
    if (!this.apiKey) {
      return {
        ok: false,
        reason: 'pdf_needs_hackclub_api_key'
      };
    }

    const payload = {
      model: this.chatModel,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Read this ${kind} file and extract concise learning notes and key facts as plain text.`
            },
            {
              type: 'file',
              file: {
                filename: `source.${kind === 'powerpoint' ? 'pptx' : kind === 'word' ? 'docx' : 'pdf'}`,
                file_data: urlString
              }
            }
          ]
        }
      ],
      plugins: kind === 'pdf' ? [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] : undefined
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
      return {
        ok: false,
        reason: `pdf_parser_http_${response.status}`,
        detail: body.slice(0, 200)
      };
    }

    const data = await response.json();
    const text = this.cleanLowQualityText(data?.choices?.[0]?.message?.content || '');

    if (!this.hasEnoughLanguageSignal(text)) {
      return {
        ok: false,
        reason: 'pdf_parser_low_signal'
      };
    }

    return {
      ok: true,
      title: `${kind.toUpperCase()} Document`,
      text: this.summarizeText(text, 1600),
      chars: text.length
    };
  }

  decodeXmlEntities(text) {
    return String(text || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  async extractDocxTextLocally(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const candidates = ['word/document.xml', 'word/header1.xml', 'word/footer1.xml'];
    const chunks = [];

    for (const filePath of candidates) {
      const file = zip.file(filePath);
      if (!file) {
        continue;
      }

      const xml = await file.async('string');
      const matches = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
      for (const match of matches) {
        chunks.push(this.decodeXmlEntities(match[1]));
      }
    }

    return chunks.join(' ');
  }

  async extractPptxTextLocally(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const chunks = [];

    for (const slidePath of slidePaths) {
      const xml = await zip.file(slidePath).async('string');
      const matches = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
      for (const match of matches) {
        chunks.push(this.decodeXmlEntities(match[1]));
      }
    }

    return chunks.join(' ');
  }

  async extractPdfTextLocally(urlString) {
    try {
      const response = await fetch(urlString, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)'
        }
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: `pdf_local_http_${response.status}`
        };
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/pdf') && !urlString.toLowerCase().endsWith('.pdf')) {
        return {
          ok: false,
          reason: 'pdf_local_not_pdf'
        };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const parsed = await pdfParse(buffer);
      const text = this.cleanLowQualityText(parsed?.text || '');

      if (!this.hasEnoughLanguageSignal(text)) {
        return {
          ok: false,
          reason: 'pdf_local_low_signal'
        };
      }

      return {
        ok: true,
        title: 'PDF Document',
        text: this.summarizeText(text, 1600),
        chars: text.length
      };
    } catch (error) {
      debug('Local PDF parse failed for %s: %O', urlString, error);
      return {
        ok: false,
        reason: 'pdf_local_parse_failed'
      };
    }
  }

  async extractOfficeTextLocally(urlString, kind) {
    try {
      const response = await fetch(urlString, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)'
        }
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: `office_local_http_${response.status}`
        };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      let text = '';

      if (kind === 'word' && String(urlString).toLowerCase().endsWith('.docx')) {
        text = await this.extractDocxTextLocally(buffer);
      } else if (kind === 'powerpoint' && String(urlString).toLowerCase().endsWith('.pptx')) {
        text = await this.extractPptxTextLocally(buffer);
      } else {
        return {
          ok: false,
          reason: 'office_local_unsupported_format'
        };
      }

      const cleaned = this.cleanLowQualityText(text);
      if (!this.hasEnoughLanguageSignal(cleaned)) {
        return {
          ok: false,
          reason: 'office_local_low_signal'
        };
      }

      return {
        ok: true,
        title: `${kind.toUpperCase()} Document`,
        text: this.summarizeText(cleaned, 1600),
        chars: cleaned.length
      };
    } catch (error) {
      debug('Local office parse failed for %s (%s): %O', urlString, kind, error);
      return {
        ok: false,
        reason: 'office_local_parse_failed'
      };
    }
  }

  async fetchWebsite(urlString, options = {}) {
    const crawlOptions = this.normalizeCrawlOptions(options);
    const safeCheck = await this.isSafeUrl(urlString);
    if (!safeCheck.safe) {
      return {
        url: urlString,
        ok: false,
        reason: safeCheck.reason
      };
    }

    if (this.isWikipediaUrl(urlString)) {
      const wikiSummary = await this.fetchWikipediaSummary(urlString, crawlOptions);
      if (wikiSummary && wikiSummary.ok) {
        return wikiSummary;
      }

      const wikiFallback = await this.fetchWikipediaExtractFallback(urlString, crawlOptions);
      if (wikiFallback && wikiFallback.ok) {
        return wikiFallback;
      }
    }

    if (this.isGitHubRepoUrl(urlString)) {
      const gitHubSummary = await this.fetchGitHubRepoSummary(urlString, crawlOptions);
      if (gitHubSummary && gitHubSummary.ok) {
        return gitHubSummary;
      }
    }

    const attempts = Math.max(1, crawlOptions.fetchRetries);
    let lastFailure = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, crawlOptions.fetchTimeoutMs));

      try {
        const response = await fetch(urlString, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': 'iLurnWitUBot/1.0 (+learning assistant)'
          }
        });

        if (!response.ok) {
          return {
            url: urlString,
            ok: false,
            reason: `http_${response.status}`
          };
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const docKind = this.getDocumentKind(urlString, contentType);
        if (docKind) {
        let docResult = await this.extractDocumentTextWithHackClubOCR(urlString, docKind);
        const failures = [];
        if (!docResult.ok) {
          failures.push(docResult.reason);
        }

        if (!docResult.ok) {
          docResult = await this.extractDocumentTextWithChatParser(urlString, docKind);
          if (!docResult.ok) {
            failures.push(docResult.reason);
          }
        }

        if (!docResult.ok) {
          if (docKind === 'pdf') {
            docResult = await this.extractPdfTextLocally(urlString);
          } else {
            docResult = await this.extractOfficeTextLocally(urlString, docKind);
          }

          if (!docResult.ok) {
            failures.push(docResult.reason);
          }
        }

        if (!docResult.ok) {
          return {
            url: urlString,
            ok: false,
            reason: failures.join('|') || docResult.reason,
            detail: docResult.detail
          };
        }

        return {
          url: urlString,
          ok: true,
          title: docResult.title,
          text: docResult.text,
          chars: docResult.chars,
          hrefs: []
        };
      }

        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          return {
            url: urlString,
            ok: false,
            reason: 'unsupported_content_type'
          };
        }

        const html = await response.text();
        const scrapedHtml = crawlOptions.scrapeMaxChars === null ? html : html.slice(0, crawlOptions.scrapeMaxChars);
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Untitled Page';
        const preferredHtml = extractPreferredContentHtml(removeLayoutBlocks(scrapedHtml));
        const cleaned = this.cleanLowQualityText(stripHtml(preferredHtml));
        if (!this.hasEnoughLanguageSignal(cleaned)) {
          return {
            url: urlString,
            ok: false,
            reason: 'low_signal_content'
          };
        }

        const summary = this.summarizeText(cleaned, crawlOptions.summaryMaxChars);
        const hrefs = this.extractHrefs(scrapedHtml, urlString, crawlOptions);

        return {
          url: urlString,
          ok: true,
          title,
          text: summary,
          chars: cleaned.length,
          hrefs
        };
      } catch (error) {
        const reason = error.name === 'AbortError' ? 'timeout' : 'fetch_failed';
        lastFailure = {
          url: urlString,
          ok: false,
          reason
        };
        debug('Failed to fetch URL %s attempt=%d/%d: %O', urlString, attempt, attempts, error);
        if (attempt < attempts) {
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return lastFailure || {
      url: urlString,
      ok: false,
      reason: 'fetch_failed'
    };
  }

  isWithinSameOrigin(originUrl, candidateUrl) {
    try {
      const origin = new URL(originUrl);
      const candidate = new URL(candidateUrl);
      return origin.origin === candidate.origin;
    } catch {
      return false;
    }
  }

  async crawlFromUrls(seedUrls = [], options = {}) {
    const crawlOptions = this.normalizeCrawlOptions(options);
    const progress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const emitProgress = (event) => {
      if (!progress) {
        return;
      }
      try {
        progress(event);
      } catch {
        // ignore progress callback failures
      }
    };

    const requestedSeeds = Array.isArray(seedUrls) ? seedUrls.filter((item) => typeof item === 'string') : [];
    const seeds = [...new Set(requestedSeeds)].slice(
      0,
      crawlOptions.maxSeedUrls === null ? Number.POSITIVE_INFINITY : crawlOptions.maxSeedUrls
    );

    const queue = seeds.map((url) => ({ url, depth: 0, root: url }));
    const visited = new Set();
    const contexts = [];
    const failures = [];
    let recursiveProcessed = 0;
    let processedCount = 0;
    let failedCount = 0;

    emitProgress({
      type: 'crawl_start',
      seeds,
      recurseDepth: crawlOptions.recurseDepth,
      maxRecursiveUrls: crawlOptions.maxRecursiveUrls,
      maxPages: crawlOptions.maxPages,
      visited: 0,
      processed: 0,
      failed: 0
    });

    while (queue.length > 0) {
      if (crawlOptions.maxPages !== null && contexts.length >= crawlOptions.maxPages) {
        break;
      }

      const current = queue.shift();
      if (!current || !current.url) {
        continue;
      }

      const canonical = String(current.url).trim();
      if (!canonical || visited.has(canonical)) {
        continue;
      }

      visited.add(canonical);

      emitProgress({
        type: 'visit_start',
        url: canonical,
        depth: current.depth,
        queueRemaining: queue.length,
        visited: visited.size,
        processed: processedCount,
        failed: failedCount
      });

      const page = await this.fetchWebsite(canonical, crawlOptions);
      if (!page.ok) {
        failures.push({ url: canonical, reason: page.reason || 'unknown_failure' });
        failedCount += 1;
        emitProgress({
          type: 'visit_fail',
          url: canonical,
          depth: current.depth,
          reason: page.reason || 'unknown_failure',
          visited: visited.size,
          processed: processedCount,
          failed: failedCount
        });
        continue;
      }

      contexts.push({
        url: page.url,
        title: page.title,
        text: page.text,
        depth: current.depth
      });

      if (current.depth > 0) {
        recursiveProcessed += 1;
      }
      processedCount += 1;

      const contentSnippet = String(page.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 260);

      emitProgress({
        type: 'visit_success',
        url: page.url,
        depth: current.depth,
        title: page.title,
        chars: page.chars,
        hrefCount: Array.isArray(page.hrefs) ? page.hrefs.length : 0,
        snippet: contentSnippet,
        visited: visited.size,
        processed: processedCount,
        failed: failedCount
      });

      if (current.depth >= crawlOptions.recurseDepth) {
        continue;
      }

      for (const href of page.hrefs || []) {
        if (!href || visited.has(href)) {
          continue;
        }

        if (crawlOptions.sameOriginOnly && !this.isWithinSameOrigin(current.root, href)) {
          continue;
        }

        if (
          crawlOptions.maxRecursiveUrls !== null &&
          current.depth + 1 > 0 &&
          recursiveProcessed + queue.filter((item) => item.depth > 0).length >= crawlOptions.maxRecursiveUrls
        ) {
          continue;
        }

        queue.push({ url: href, depth: current.depth + 1, root: current.root });
      }
    }

    emitProgress({
      type: 'crawl_done',
      visited: visited.size,
      processed: processedCount,
      failed: failedCount,
      recursiveProcessed
    });

    return {
      contexts,
      failures,
      stats: {
        visited: visited.size,
        queuedRemaining: queue.length,
        recurseDepth: crawlOptions.recurseDepth,
        maxPages: crawlOptions.maxPages,
        maxRecursiveUrls: crawlOptions.maxRecursiveUrls,
        recursiveProcessed,
        sameOriginOnly: crawlOptions.sameOriginOnly,
        summaryMaxChars: crawlOptions.summaryMaxChars,
        scrapeMaxChars: crawlOptions.scrapeMaxChars,
        fetchTimeoutMs: crawlOptions.fetchTimeoutMs,
        fetchRetries: crawlOptions.fetchRetries,
        maxHrefsPerPage: crawlOptions.maxHrefsPerPage,
        maxSeedUrls: crawlOptions.maxSeedUrls
      }
    };
  }
}

module.exports = WebLearner;
