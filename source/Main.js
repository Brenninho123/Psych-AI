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

let conversations = [];
let activeId = null;
let isStreaming = false;
let abortController = null;
let searchTerm = "";

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
  abortController = new AbortController();

  try {
    const response = await fetch(API_URL + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: convo.messages.map(stripInternalFields) }),
      signal: abortController.signal
    });

    if (!response.ok) throw new Error("Request failed with status " + response.status);

    typingRow.remove();

    let fullText = "";
    const aiMsgId = uid();
    const built = appendMessageElement("ai", "", aiMsgId);

    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        fullText += decoder.decode(chunk.value, { stream: true });
        built.bubble.innerHTML = formatMessage(fullText);
        bindCodeCopyButtons(built.bubble);
        scrollToBottom(false);
      }
    } else {
      const data = await response.json();
      fullText = data.reply || "";
      built.bubble.innerHTML = formatMessage(fullText);
      bindCodeCopyButtons(built.bubble);
    }

    convo.messages.push({ id: aiMsgId, role: "assistant", content: fullText });
    touchConversation(convo);
    saveConversations();
    renderSidebar();
    setConnectionStatus(true);
  } catch (err) {
    typingRow.remove();
    if (err.name !== "AbortError") {
      appendMessageElement("ai", "Error connecting to the server. Try again later.", uid());
      setConnectionStatus(false);
      showToast("Connection error", true);
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
  if (isStreaming && abortController) {
    abortController.abort();
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

function init() {
  loadConversations();
  if (!getActiveConversation() && conversations.length > 0) {
    activeId = conversations[0].id;
  }
  setConnectionStatus(navigator.onLine);
  renderSidebar();
  renderActiveConversation();
  bindSuggestionChips();
}

init();
