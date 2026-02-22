const chatEl = document.getElementById('chat');
const historyEl = document.getElementById('chat-history');
const titleEl = document.getElementById('chat-title');
const newChatBtn = document.getElementById('new-chat');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('message');
const urlEl = document.getElementById('url');
const mentorEnabledEl = document.getElementById('mentor-enabled');
const deepResearchEl = document.getElementById('deep-research');
const deepDepthEl = document.getElementById('deep-depth');
const deepLimitEl = document.getElementById('deep-limit');
const thinkingContainerEl = document.getElementById('thinking-container');
const thinkingHeaderEl = document.getElementById('thinking-header');
const thinkingStatusEl = document.getElementById('thinking-status');
const thinkingContentEl = document.getElementById('thinking-content');
const thinkingLogsEl = document.getElementById('thinking-logs');
const thinkingMetaEl = document.getElementById('thinking-meta');

const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const toggleControlsBtn = document.getElementById('toggle-controls-btn');
const sidebarEl = document.getElementById('sidebar');
const controlsEl = document.getElementById('controls');
const sendBtn = document.getElementById('send-btn');

if (toggleSidebarBtn && sidebarEl) {
  toggleSidebarBtn.addEventListener('click', () => {
    sidebarEl.classList.toggle('open');
  });
}

  if (toggleControlsBtn && controlsEl) {
    toggleControlsBtn.addEventListener('click', () => {
      controlsEl.classList.toggle('open');
      chatEl.scrollTop = chatEl.scrollHeight;
    });
  }

  if (thinkingHeaderEl && thinkingContainerEl && thinkingContentEl) {
    thinkingHeaderEl.addEventListener('click', () => {
      thinkingContainerEl.classList.toggle('open');
      thinkingContentEl.style.display = thinkingContainerEl.classList.contains('open') ? 'block' : 'none';
      chatEl.scrollTop = chatEl.scrollHeight;
    });
  }

if (inputEl) {
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
    
    if (sendBtn) {
      sendBtn.disabled = inputEl.value.trim().length === 0;
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputEl.value.trim().length > 0) {
        formEl.requestSubmit();
      }
    }
  });
}

const CHATS_KEY = 'chatHistoryList';
const ACTIVE_CHAT_KEY = 'activeChatId';

let mentorEnabled = localStorage.getItem('mentorEnabled');
mentorEnabled = mentorEnabled === null ? true : mentorEnabled === 'true';
mentorEnabledEl.checked = mentorEnabled;

let deepResearchEnabled = localStorage.getItem('deepResearchEnabled') === 'true';
let deepResearchDepth = Number(localStorage.getItem('deepResearchDepth') || '1');
let deepResearchLimit = Number(localStorage.getItem('deepResearchLimit') || '20');

if (!Number.isFinite(deepResearchDepth) || deepResearchDepth < 1) {
  deepResearchDepth = 1;
}
if (!Number.isFinite(deepResearchLimit) || deepResearchLimit < 1) {
  deepResearchLimit = 20;
}

deepResearchEl.checked = deepResearchEnabled;
deepDepthEl.value = String(deepResearchDepth);
deepLimitEl.value = String(deepResearchLimit);

let chats = loadChats();
let activeChatId = localStorage.getItem(ACTIVE_CHAT_KEY) || '';
if (!activeChatId || !chats.find((item) => item.id === activeChatId)) {
  const chat = createNewChat();
  activeChatId = chat.id;
}

renderHistory();
renderActiveChat();

mentorEnabledEl.addEventListener('change', () => {
  mentorEnabled = mentorEnabledEl.checked;
  localStorage.setItem('mentorEnabled', String(mentorEnabled));
});

function syncDeepResearchControls() {
  deepDepthEl.disabled = !deepResearchEnabled;
  deepLimitEl.disabled = !deepResearchEnabled;
}

deepResearchEl.addEventListener('change', () => {
  deepResearchEnabled = deepResearchEl.checked;
  localStorage.setItem('deepResearchEnabled', String(deepResearchEnabled));
  syncDeepResearchControls();
});

deepDepthEl.addEventListener('change', () => {
  const nextValue = Math.max(1, Number(deepDepthEl.value || '1'));
  deepResearchDepth = Number.isFinite(nextValue) ? nextValue : 1;
  deepDepthEl.value = String(deepResearchDepth);
  localStorage.setItem('deepResearchDepth', String(deepResearchDepth));
});

deepLimitEl.addEventListener('change', () => {
  const nextValue = Math.max(1, Number(deepLimitEl.value || '20'));
  deepResearchLimit = Number.isFinite(nextValue) ? nextValue : 20;
  deepLimitEl.value = String(deepResearchLimit);
  localStorage.setItem('deepResearchLimit', String(deepResearchLimit));
});

newChatBtn.addEventListener('click', () => {
  const chat = createNewChat();
  setActiveChat(chat.id);
});

syncDeepResearchControls();

async function syncMentorDefault() {
  if (localStorage.getItem('mentorEnabled') !== null) {
    return;
  }

  try {
    const response = await fetch('/api/stats');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (typeof data.mentorEnabled === 'boolean') {
      mentorEnabled = data.mentorEnabled;
      mentorEnabledEl.checked = mentorEnabled;
      localStorage.setItem('mentorEnabled', String(mentorEnabled));
    }
  } catch {
    // Ignore optional default sync failures
  }
}

syncMentorDefault();

function makeChatId() {
  return `chat-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function defaultChatTitle() {
  return 'New Chat';
}

function loadChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((chat) => ({
      id: String(chat.id || makeChatId()),
      title: String(chat.title || defaultChatTitle()),
      sessionId: String(chat.sessionId || ''),
      createdAt: Number(chat.createdAt || Date.now()),
      updatedAt: Number(chat.updatedAt || Date.now()),
      messages: Array.isArray(chat.messages) ? chat.messages : []
    }));
  } catch {
    return [];
  }
}

function saveChats() {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

function getActiveChat() {
  return chats.find((chat) => chat.id === activeChatId) || null;
}

function createNewChat() {
  const chat = {
    id: makeChatId(),
    title: defaultChatTitle(),
    sessionId: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  chats.unshift(chat);
  saveChats();
  renderHistory();
  return chat;
}

function setActiveChat(chatId) {
  activeChatId = chatId;
  localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
  renderHistory();
  renderActiveChat();
}

function updateChatTitle(chat) {
  if (!chat) {
    return;
  }
  const firstUser = chat.messages.find((item) => item.role === 'user' && item.text && !item.hidden);
  if (!firstUser) {
    chat.title = defaultChatTitle();
    return;
  }
  const compact = String(firstUser.text).replace(/\s+/g, ' ').trim();
  chat.title = compact.length > 36 ? `${compact.slice(0, 36)}...` : compact;
}

function sortChatsByUpdated() {
  chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

function addMessageToChat(chat, role, text, options = {}) {
  if (!chat) {
    return;
  }

  chat.messages.push({
    role,
    text,
    hidden: Boolean(options.hidden),
    at: Date.now()
  });

  chat.updatedAt = Date.now();
  updateChatTitle(chat);
  sortChatsByUpdated();
  saveChats();
  renderHistory();
  if (chat.id === activeChatId) {
    renderActiveChat();
  }
}

function updateLastBotMessage(chat, text) {
  if (!chat || !chat.messages.length) {
    return;
  }

  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    if (chat.messages[index].role === 'bot') {
      chat.messages[index].text = text;
      chat.updatedAt = Date.now();
      saveChats();
      if (chat.id === activeChatId) {
        renderActiveChat();
      }
      return;
    }
  }
}

function clearThinking() {
  if (thinkingLogsEl) thinkingLogsEl.textContent = '';
  if (thinkingMetaEl) thinkingMetaEl.textContent = '';
  if (thinkingStatusEl) thinkingStatusEl.textContent = 'Thinking...';
  if (thinkingContainerEl) {
    thinkingContainerEl.style.display = 'none';
    thinkingContainerEl.classList.remove('open');
  }
  if (thinkingContentEl) thinkingContentEl.style.display = 'none';
}

function addThinking(text) {
  if (!thinkingLogsEl) return;
  if (thinkingContainerEl && thinkingContainerEl.style.display === 'none') {
    thinkingContainerEl.style.display = 'block';
  }
  const line = document.createElement('div');
  line.className = 'think-line';
  line.textContent = `• ${text}`;
  thinkingLogsEl.appendChild(line);
  thinkingLogsEl.scrollTop = thinkingLogsEl.scrollHeight;
}

function updateThinkingMeta(key, value) {
  if (!thinkingMetaEl) return;
  
  let item = Array.from(thinkingMetaEl.children).find(el => el.dataset.key === key);
  if (!item) {
    item = document.createElement('div');
    item.className = 'meta-item';
    item.dataset.key = key;
    
    const label = document.createElement('div');
    label.className = 'meta-label';
    label.textContent = key;
    
    const val = document.createElement('div');
    val.className = 'meta-value';
    
    item.appendChild(label);
    item.appendChild(val);
    thinkingMetaEl.appendChild(item);
  }
  
  item.querySelector('.meta-value').textContent = value;
}

function shortSnippet(text, limit = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit).trim()}...`;
}

function formatAge(timestamp) {
  const delta = Math.max(0, Date.now() - Number(timestamp || 0));
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function renderHistory() {
  historyEl.textContent = '';

  if (!chats.length) {
    const empty = document.createElement('div');
    empty.className = 'history-sub';
    empty.textContent = 'No chats yet.';
    historyEl.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `history-item${chat.id === activeChatId ? ' active' : ''}`;

    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = chat.title || defaultChatTitle();

    const sub = document.createElement('div');
    sub.className = 'history-sub';
    sub.textContent = `${chat.messages.length} msg • ${formatAge(chat.updatedAt)}`;

    button.appendChild(title);
    button.appendChild(sub);
    button.addEventListener('click', () => setActiveChat(chat.id));
    historyEl.appendChild(button);
  }
}

function renderActiveChat() {
  const chat = getActiveChat();
  if (!chat) {
    chatEl.textContent = '';
    titleEl.textContent = defaultChatTitle();
    return;
  }

  titleEl.textContent = chat.title || defaultChatTitle();
  chatEl.textContent = '';

  for (const message of chat.messages) {
    if (message.hidden) {
      continue;
    }
    const row = document.createElement('div');
    row.className = `msg ${message.role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = message.role === 'user' ? 'U' : 'AI';
    
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = message.text;
    
    row.appendChild(avatar);
    row.appendChild(content);
    chatEl.appendChild(row);
  }

  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendMessageStream(message, url, onEvent) {
  const chat = getActiveChat();
  if (!chat) {
    throw new Error('No active chat');
  }

  const urls = [];
  if (url) {
    urls.push(url);
  }

  const webOptions = buildWebOptions();

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      sessionId: chat.sessionId || '',
      urls,
      mentorEnabled,
      webOptions
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let eventType = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let splitIndex;
    while ((splitIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);

      const lines = rawEvent.split('\n');
      let dataText = '';
      eventType = 'message';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataText += line.slice(5).trim();
        }
      }

      if (!dataText) {
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(dataText);
      } catch {
        continue;
      }

      onEvent(eventType, payload);
    }
  }
}

function buildWebOptions() {
  const options = {
    summaryMaxChars: 'unlimited',
    scrapeMaxChars: 'unlimited',
    maxPages: 'unlimited',
    searchEnabled: true,
    searchMaxResults: 5
  };

  if (deepResearchEnabled) {
    options.recurseDepth = Math.max(1, Number(deepDepthEl.value || deepResearchDepth || 1));
    options.maxRecursiveUrls = Math.max(1, Number(deepLimitEl.value || deepResearchLimit || 20));
  } else {
    options.recurseDepth = 0;
    options.maxRecursiveUrls = 0;
  }

  return options;
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  const url = urlEl.value.trim();
  if (!message) {
    return;
  }

  const chat = getActiveChat();
  if (!chat) {
    return;
  }

  inputEl.value = '';
  inputEl.style.height = 'auto';
  if (sendBtn) {
    sendBtn.disabled = true;
  }
  urlEl.value = '';
  clearThinking();
  
  if (thinkingContainerEl) {
    thinkingContainerEl.style.display = 'block';
    thinkingContainerEl.classList.add('open');
  }
  if (thinkingContentEl) {
    thinkingContentEl.style.display = 'block';
  }
  const spinner = document.querySelector('.thinking-spinner');
  if (spinner) spinner.style.display = 'block';
  
  addThinking('Starting reasoning...');

  addMessageToChat(chat, 'user', message);
  if (url) {
    addMessageToChat(chat, 'user', `URL: ${url}`, { hidden: true });
  }
  addMessageToChat(chat, 'bot', '');

  try {
    let streamedText = '';

    await sendMessageStream(message, url, (type, payload) => {
      if (type === 'token') {
        streamedText += payload.token;
        updateLastBotMessage(chat, streamedText);
        return;
      }

      if (type === 'reasoning') {
        addThinking(`Summary: ${payload.text}`);
        return;
      }

      if (type === 'thinking') {
        addThinking(payload.text);
        return;
      }

      if (type === 'scrape') {
        if (payload.type === 'mentor_start') {
          addThinking('Mentor AI is stepping in to help...');
          if (thinkingStatusEl) thinkingStatusEl.textContent = 'Mentor AI is teaching...';
        } else if (payload.type === 'mentor_done') {
          addThinking('Mentor AI finished teaching.');
        } else if (payload.type === 'search_start') {
          addThinking(`Web search started: "${payload.query}"`);
          if (thinkingStatusEl) thinkingStatusEl.textContent = `Searching web for "${payload.query}"...`;
        } else if (payload.type === 'search_done') {
          addThinking(`Web search ${payload.ok ? 'found' : 'did not find'} sources (${payload.urlCount || 0}).`);
        } else if (payload.type === 'visit_start') {
          addThinking(
            `Scraping depth ${payload.depth}: ${payload.url} | visited=${payload.visited || 0}, processed=${payload.processed || 0}, failed=${payload.failed || 0}`
          );
          if (thinkingStatusEl) thinkingStatusEl.textContent = `Crawling ${payload.url}...`;
        } else if (payload.type === 'visit_success') {
          addThinking(
            `Learned from ${payload.title || payload.url} (${payload.chars || 0} chars) | visited=${payload.visited || 0}, processed=${payload.processed || 0}, failed=${payload.failed || 0}`
          );
          if (payload.snippet) {
            addThinking(`Content: ${shortSnippet(payload.snippet)}`);
          }
        } else if (payload.type === 'visit_fail') {
          addThinking(
            `Failed ${payload.url}: ${payload.reason} | visited=${payload.visited || 0}, processed=${payload.processed || 0}, failed=${payload.failed || 0}`
          );
        } else if (payload.type === 'crawl_done') {
          addThinking(`Crawl complete. visited=${payload.visited}, processed=${payload.processed}, failed=${payload.failed}`);
        }
        return;
      }

      if (type === 'stage') {
        addThinking(payload.label);
        if (thinkingStatusEl) thinkingStatusEl.textContent = payload.label;
        return;
      }

      if (type === 'done') {
        chat.sessionId = payload.sessionId || chat.sessionId;
        chat.updatedAt = Date.now();
        saveChats();
        renderHistory();

        const failureText = (payload.debug.webUrlsFailed || []).length
          ? ` | webFail=${payload.debug.webUrlsFailed.map((item) => `${item.reason}`).join(',')}`
          : '';
        const crawlText = payload.debug.webCrawl
          ? ` | crawlVisited=${payload.debug.webCrawl.visited} | recursiveProcessed=${payload.debug.webCrawl.recursiveProcessed}`
          : '';
        const memoryLineText = payload.debug.memoryReadLine
          ? ` | memoryLine=${payload.debug.memoryReadLine} (idx=${payload.debug.memoryReadIndex})`
          : '';
        
        addThinking(
          `Tokens=${payload.debug.responseTokens}, TPS=${payload.debug.tokensPerSecond}, Took=${payload.debug.durationMs}ms, StreamTPS=${payload.debug.streamedTokensPerSecond}`
        );
        if (payload.debug.memoryReadLine) {
          addThinking(`Read from memory line ${payload.debug.memoryReadLine} (interaction index ${payload.debug.memoryReadIndex})`);
        }
        addThinking('Done.');
        
        if (thinkingStatusEl) thinkingStatusEl.textContent = 'Finished thinking';
        const spinner = document.querySelector('.thinking-spinner');
        if (spinner) spinner.style.display = 'none';
        
        updateThinkingMeta('Tokens', payload.debug.responseTokens);
        updateThinkingMeta('TPS', payload.debug.tokensPerSecond);
        updateThinkingMeta('Stream TPS', payload.debug.streamedTokensPerSecond);
        updateThinkingMeta('Time', `${payload.debug.durationMs}ms`);
        updateThinkingMeta('Source', payload.debug.source);
        updateThinkingMeta('Confidence', payload.debug.confidence.toFixed(2));
        if (payload.debug.webUrlsProcessed > 0) {
          updateThinkingMeta('Web Sources', payload.debug.webUrlsProcessed);
        }
      }
    });
  } catch (error) {
    updateLastBotMessage(chat, 'Something went wrong. Check server logs.');
    addThinking(`Error: ${error.message}`);
  }
});