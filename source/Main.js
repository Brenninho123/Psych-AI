const API_URL = "";
const STORAGE_KEY = "psychai_conversations";
const ACTIVE_KEY = "psychai_active_id";

const chat = document.getElementById("chat");
const chatWrapper = document.getElementById("chat-wrapper");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const historyList = document.getElementById("history-list");
const emptyHistoryLabel = document.getElementById("chat-count");
const searchBox = document.getElementById("search-box");
const newChatBtn = document.getElementById("new-chat-btn");
const clearAllBtn = document.getElementById("clear-all-btn");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const menuToggle = document.getElementById("menu-toggle");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const scrollBottomBtn = document.getElementById("scroll-bottom-btn");
const connectionDot = document.getElementById("connection-dot");
const toastContainer = document.getElementById("toast-container");
const installBtn = document.getElementById("install-btn");
const luaToolsBtn = document.getElementById("lua-tools-btn");
const luaModalOverlay = document.getElementById("lua-modal-overlay");
const luaModalClose = document.getElementById("lua-modal-close");
const luaModalCancel = document.getElementById("lua-modal-cancel");
const luaModalGenerate = document.getElementById("lua-modal-generate");
const luaTemplateSelect = document.getElementById("lua-template-select");
const luaTemplateDesc = document.getElementById("lua-template-desc");
const luaConfigInput = document.getElementById("lua-config-input");
const luaConfigError = document.getElementById("lua-config-error");

let conversations = [];
let activeId = null;
let isStreaming = false;
let searchTerm = "";

const LUA_DEFAULT_CONFIGS = {
  holdCover: {
    isPixelDefault: false,
    endDelay: 10,
    disappearDelay: 0.3,
    dadHoldSustains: true
  },
  characterGroup: {
    picoEnabled: true,
    groups: {
      bf: ["bf", "bf-car", "bf-christmas", "bf-pixel", "bf-dark"],
      pico: ["pico-playable", "pico-christmas", "pico-dark", "pico-pixel", "pico-player"]
    },
    scripts: {
      bf: "scripts/players/bf",
      pico: "scripts/players/pico"
    }
  },
  noteSplash: {
    spritesheet: "NOTE_hold_assets",
    colors: ["purple", "blue", "green", "red"],
    useRatingColors: true,
    disableDefault: true,
    poolSize: 8
  },
  scoreTally: {
    spritesheet: "resultScreen/tallieNumber"
  }
};

function hasLuaEngine() {
  return typeof window.LuaCode !== "undefined";
}

const api = new window.PsychAPI.PsychAPI({ baseUrl: API_URL, timeout: 30000, maxRetries: 2 });

api.addEventListener("statuschange", function(e) {
  setConnectionStatus(e.detail.online);
});

api.addEventListener("retry", function(e) {
  showToast("Retrying request (attempt " + e.detail.attempt + ")...");
});

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    conversations = raw ? JSON.parse(raw) : [];
  } catch (err) {
    conversations = [];
  }
  activeId = localStorage.getItem(ACTIVE_KEY) || null;
}

function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  } catch (err) {
    showToast("Failed to save chat history", true);
  }
}

function getActiveConversation() {
  return conversations.find(function(c) { return c.id === activeId; }) || null;
}

function createConversation() {
  const convo = {
    id: uid(),
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  conversations.unshift(convo);
  activeId = convo.id;
  saveConversations();
  return convo;
}

function deleteConversation(id) {
  conversations = conversations.filter(function(c) { return c.id !== id; });
  if (activeId === id) {
    activeId = conversations.length ? conversations[0].id : null;
  }
  saveConversations();
  renderSidebar();
  renderActiveConversation();
}

function touchConversation(convo) {
  convo.updatedAt = Date.now();
  const index = conversations.findIndex(function(c) { return c.id === convo.id; });
  if (index > 0) {
    conversations.splice(index, 1);
    conversations.unshift(convo);
  }
}

function deriveTitle(text) {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 42 ? clean.slice(0, 42) + "..." : clean;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMessage(text) {
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    const plain = parts[i];
    if (plain) html += escapeHtml(plain).replace(/\n/g, "<br>");
    const lang = parts[i + 1];
    const code = parts[i + 2];
    if (code !== undefined) {
      const codeId = "code-" + uid();
      html += '<div class="code-block">';
      html += '<div class="code-block-header"><span>' + (lang || "text") + '</span>';
      html += '<button class="copy-btn" data-code-target="' + codeId + '">Copy</button></div>';
      html += '<pre><code id="' + codeId + '">' + escapeHtml(code.trim()) + '</code></pre>';
      html += '</div>';
    }
  }
  return html || escapeHtml(text);
}

function isNearBottom() {
  const threshold = 120;
  return chatWrapper.scrollHeight - chatWrapper.scrollTop - chatWrapper.clientHeight < threshold;
}

function scrollToBottom(force) {
  if (force || isNearBottom()) {
    chatWrapper.scrollTop = chatWrapper.scrollHeight;
  }
}

function renderActiveConversation() {
  chat.innerHTML = "";
  const convo = getActiveConversation();

  if (!convo || convo.messages.length === 0) {
    chat.innerHTML =
      '<div id="empty-state">' +
      '<div class="logo-mark"></div>' +
      '<h2>Ask anything about Psych Engine</h2>' +
      '<p>Scripts, HScript, mechanics, errors, whatever you need.</p>' +
      '<div id="suggestions">' +
      '<div class="suggestion-chip">How does note spawning work?</div>' +
      '<div class="suggestion-chip">Write an HScript for a custom event</div>' +
      '<div class="suggestion-chip">Fix a crash on song start</div>' +
      '<div class="suggestion-chip">Explain the character JSON format</div>' +
      '</div></div>';
    bindSuggestionChips();
    return;
  }

  convo.messages.forEach(function(msg) {
    appendMessageElement(msg.role, msg.content, msg.id);
  });
  scrollToBottom(true);
}

function bindSuggestionChips() {
  const chips = document.querySelectorAll(".suggestion-chip");
  chips.forEach(function(chip) {
    chip.addEventListener("click", function() {
      input.value = chip.textContent;
      autoResize();
      sendMessage();
    });
  });
}

function appendMessageElement(role, text, messageId) {
  const row = document.createElement("div");
  row.className = "msg-row " + role;
  row.dataset.id = messageId || uid();

  const avatar = document.createElement("div");
  avatar.className = "avatar " + role;
  avatar.textContent = role === "user" ? "U" : "AI";

  const col = document.createElement("div");
  col.className = "msg-col";

  const bubble = document.createElement("div");
  bubble.className = "msg";
  bubble.innerHTML = formatMessage(text);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const copyAllBtn = document.createElement("button");
  copyAllBtn.className = "msg-action-btn";
  copyAllBtn.textContent = "Copy";
  copyAllBtn.addEventListener("click", function() {
    copyToClipboard(text);
  });
  actions.appendChild(copyAllBtn);

  col.appendChild(bubble);
  col.appendChild(actions);
  row.appendChild(avatar);
  row.appendChild(col);
  chat.appendChild(row);

  bubble.querySelectorAll(".copy-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      const codeEl = document.getElementById(btn.dataset.codeTarget);
      if (!codeEl) return;
      copyToClipboard(codeEl.textContent, btn);
    });
  });

  return { row: row, bubble: bubble };
}

function copyToClipboard(text, btnEl) {
  navigator.clipboard.writeText(text).then(function() {
    if (btnEl) {
      const original = btnEl.textContent;
      btnEl.textContent = "Copied";
      btnEl.classList.add("copied");
      setTimeout(function() {
        btnEl.textContent = original;
        btnEl.classList.remove("copied");
      }, 1500);
    } else {
      showToast("Copied to clipboard");
    }
  }).catch(function() {
    showToast("Could not copy", true);
  });
}

function showToast(message, isError) {
  const toast = document.createElement("div");
  toast.className = "toast" + (isError ? " error" : "");
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(function() {
    toast.remove();
  }, 3000);
}

function renderSidebar() {
  historyList.innerHTML = "";
  const filtered = conversations.filter(function(c) {
    if (!searchTerm) return true;
    return c.title.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1;
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.id = "empty-history";
    empty.textContent = searchTerm ? "No chats found" : "No chats yet";
    historyList.appendChild(empty);
  }

  filtered.forEach(function(convo) {
    const item = document.createElement("div");
    item.className = "history-item" + (convo.id === activeId ? " active" : "");

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = convo.title;

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "\u00d7";
    delBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      deleteConversation(convo.id);
    });

    item.appendChild(label);
    item.appendChild(delBtn);
    item.addEventListener("click", function() {
      activeId = convo.id;
      saveConversations();
      renderSidebar();
      renderActiveConversation();
      closeMobileSidebar();
    });

    historyList.appendChild(item);
  });

  emptyHistoryLabel.textContent = conversations.length + (conversations.length === 1 ? " chat" : " chats");
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

function setSendButtonMode(streaming) {
  isStreaming = streaming;
  sendBtn.classList.toggle("stop-mode", streaming);
  sendBtn.disabled = false;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming) return;

  if (tryHandleSlashCommand(text)) {
    input.value = "";
    autoResize();
    return;
  }

  let convo = getActiveConversation();
  if (!convo) convo = createConversation();

  const isFirstMessage = convo.messages.length === 0;
  if (isFirstMessage) convo.title = deriveTitle(text);

  const userMsgId = uid();
  convo.messages.push({ id: userMsgId, role: "user", content: text });
  touchConversation(convo);
  saveConversations();
  renderSidebar();

  input.value = "";
  autoResize();
  appendMessageElement("user", text, userMsgId);
  scrollToBottom(true);

  const typingRow = document.createElement("div");
  typingRow.className = "msg-row ai";
  typingRow.innerHTML =
    '<div class="avatar ai">AI</div>' +
    '<div class="msg-col"><div class="msg"><div class="typing"><span></span><span></span><span></span></div></div></div>';
  chat.appendChild(typingRow);
  scrollToBottom(true);

  setSendButtonMode(true);

  try {
    let firstChunkReceived = false;
    let built = null;
    const aiMsgId = uid();

    const fullText = await api.chat(convo.messages.map(stripInternalFields), {
      onChunk: function(piece, accumulated) {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          typingRow.remove();
          built = appendMessageElement("ai", "", aiMsgId);
        }
        built.bubble.innerHTML = formatMessage(accumulated);
        bindCodeCopyButtons(built.bubble);
        scrollToBottom(false);
      }
    });

    typingRow.remove();
    if (!built) {
      built = appendMessageElement("ai", "", aiMsgId);
    }
    built.bubble.innerHTML = formatMessage(fullText);
    bindCodeCopyButtons(built.bubble);

    convo.messages.push({ id: aiMsgId, role: "assistant", content: fullText });
    touchConversation(convo);
    saveConversations();
    renderSidebar();
  } catch (err) {
    typingRow.remove();
    if (err.type !== "aborted") {
      let message = err.message || "Something went wrong. Try again later.";
      if (err.type === "network") message = "Could not reach the server. Check your connection.";
      if (err.type === "rate_limit") message = "Too many requests. Wait a moment and try again.";
      if (err.type === "stream_timeout") message = "The response stalled. Try again.";
      appendMessageElement("ai", message, uid());
      showToast(message, true);
    }
  } finally {
    setSendButtonMode(false);
    input.focus();
    scrollToBottom(true);
  }
}

function stripInternalFields(msg) {
  return { role: msg.role, content: msg.content };
}

function bindCodeCopyButtons(bubble) {
  bubble.querySelectorAll(".copy-btn").forEach(function(btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", function() {
      const codeEl = document.getElementById(btn.dataset.codeTarget);
      if (!codeEl) return;
      copyToClipboard(codeEl.textContent, btn);
    });
  });
}

function setConnectionStatus(online) {
  connectionDot.classList.toggle("offline", !online);
}

function openMobileSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("active");
}

function closeMobileSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("active");
}

input.addEventListener("input", autoResize);

input.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", function() {
  if (isStreaming) {
    api.cancel();
    return;
  }
  sendMessage();
});

newChatBtn.addEventListener("click", function() {
  createConversation();
  renderSidebar();
  renderActiveConversation();
  closeMobileSidebar();
  input.focus();
});

clearAllBtn.addEventListener("click", function() {
  if (conversations.length === 0) return;
  const confirmed = window.confirm("Delete all conversations? This cannot be undone.");
  if (!confirmed) return;
  conversations = [];
  activeId = null;
  saveConversations();
  renderSidebar();
  renderActiveConversation();
});

searchBox.addEventListener("input", function() {
  searchTerm = searchBox.value.trim();
  renderSidebar();
});

menuToggle.addEventListener("click", openMobileSidebar);
closeSidebarBtn.addEventListener("click", closeMobileSidebar);
sidebarOverlay.addEventListener("click", closeMobileSidebar);

chatWrapper.addEventListener("scroll", function() {
  scrollBottomBtn.classList.toggle("visible", !isNearBottom());
});

scrollBottomBtn.addEventListener("click", function() {
  scrollToBottom(true);
});

window.addEventListener("online", function() { setConnectionStatus(true); });
window.addEventListener("offline", function() { setConnectionStatus(false); });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function() {
    navigator.serviceWorker.register("/sw.js").catch(function() {});
  });
}

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", function(e) {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = "flex";
});

installBtn.addEventListener("click", async function() {
  if (!deferredPrompt) return;
  installBtn.style.display = "none";
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});

window.addEventListener("appinstalled", function() {
  installBtn.style.display = "none";
});

function populateLuaTemplateSelect() {
  luaTemplateSelect.innerHTML = "";
  if (!hasLuaEngine()) {
    const opt = document.createElement("option");
    opt.textContent = "LuaCode engine not loaded";
    luaTemplateSelect.appendChild(opt);
    luaTemplateSelect.disabled = true;
    return;
  }
  window.LuaCode.list().forEach(function(tpl) {
    const opt = document.createElement("option");
    opt.value = tpl.id;
    opt.textContent = tpl.label;
    luaTemplateSelect.appendChild(opt);
  });
  updateLuaTemplatePreview();
}

function updateLuaTemplatePreview() {
  if (!hasLuaEngine()) return;
  const id = luaTemplateSelect.value;
  const list = window.LuaCode.list();
  const meta = list.find(function(t) { return t.id === id; });
  luaTemplateDesc.textContent = meta ? meta.description : "";
  const defaultConfig = LUA_DEFAULT_CONFIGS[id] || {};
  luaConfigInput.value = JSON.stringify(defaultConfig, null, 2);
  luaConfigError.classList.remove("visible");
}

function openLuaModal() {
  if (!hasLuaEngine()) {
    showToast("LuaCode engine failed to load", true);
    return;
  }
  populateLuaTemplateSelect();
  luaModalOverlay.classList.add("active");
}

function closeLuaModal() {
  luaModalOverlay.classList.remove("active");
  luaConfigError.classList.remove("visible");
}

function insertGeneratedLuaMessage(templateId, code, userNote) {
  let convo = getActiveConversation();
  if (!convo) convo = createConversation();

  const isFirstMessage = convo.messages.length === 0;
  const noteText = userNote || ("Generate Lua script: " + templateId);
  if (isFirstMessage) convo.title = deriveTitle(noteText);

  const userMsgId = uid();
  convo.messages.push({ id: userMsgId, role: "user", content: noteText });
  appendMessageElement("user", noteText, userMsgId);

  const aiMsgId = uid();
  const fenced = "```lua\n" + code + "\n```";
  convo.messages.push({ id: aiMsgId, role: "assistant", content: fenced });
  appendMessageElement("ai", fenced, aiMsgId);

  touchConversation(convo);
  saveConversations();
  renderSidebar();
  scrollToBottom(true);
}

function handleLuaGenerate() {
  const id = luaTemplateSelect.value;
  let config = {};

  try {
    const raw = luaConfigInput.value.trim();
    config = raw ? JSON.parse(raw) : {};
  } catch (err) {
    luaConfigError.textContent = "Invalid JSON: " + err.message;
    luaConfigError.classList.add("visible");
    return;
  }

  try {
    const code = window.LuaCode.generate(id, config);
    const meta = window.LuaCode.list().find(function(t) { return t.id === id; });
    insertGeneratedLuaMessage(id, code, "Generate Lua script: " + (meta ? meta.label : id));
    closeLuaModal();
  } catch (err) {
    luaConfigError.textContent = "Generation failed: " + err.message;
    luaConfigError.classList.add("visible");
  }
}

function tryHandleSlashCommand(text) {
  if (text.indexOf("/lua") !== 0) return false;
  if (!hasLuaEngine()) {
    showToast("LuaCode engine failed to load", true);
    return true;
  }

  const rest = text.slice(4).trim();
  const firstSpace = rest.indexOf(" ");
  const templateId = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const configRaw = firstSpace === -1 ? "" : rest.slice(firstSpace + 1).trim();

  const known = window.LuaCode.list().map(function(t) { return t.id; });
  if (!templateId || known.indexOf(templateId) === -1) {
    showToast("Unknown template. Available: " + known.join(", "), true);
    return true;
  }

  let config = LUA_DEFAULT_CONFIGS[templateId] || {};
  if (configRaw) {
    try {
      config = JSON.parse(configRaw);
    } catch (err) {
      showToast("Invalid JSON in command: " + err.message, true);
      return true;
    }
  }

  try {
    const code = window.LuaCode.generate(templateId, config);
    insertGeneratedLuaMessage(templateId, code, text);
  } catch (err) {
    showToast("Generation failed: " + err.message, true);
  }

  return true;
}

luaToolsBtn.addEventListener("click", openLuaModal);
luaModalClose.addEventListener("click", closeLuaModal);
luaModalCancel.addEventListener("click", closeLuaModal);
luaModalOverlay.addEventListener("click", function(e) {
  if (e.target === luaModalOverlay) closeLuaModal();
});
luaTemplateSelect.addEventListener("change", updateLuaTemplatePreview);
luaModalGenerate.addEventListener("click", handleLuaGenerate);

function init() {
  loadConversations();
  if (!getActiveConversation() && conversations.length > 0) {
    activeId = conversations[0].id;
  }
  setConnectionStatus(navigator.onLine);
  renderSidebar();
  renderActiveConversation();
  bindSuggestionChips();
  api.health();
  api.startHealthPolling(30000);
}

init();
