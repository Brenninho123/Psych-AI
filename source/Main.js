const API_URL = "";

const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
let emptyState = document.getElementById("empty-state");

let history = [];

function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMessage(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/```([\s\S]*?)```/g, function(match, code) {
    return "<pre><code>" + code.trim() + "</code></pre>";
  });
}

function addMessage(role, text) {
  if (emptyState) {
    emptyState.remove();
    emptyState = null;
  }
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.innerHTML = formatMessage(text);
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function addTypingIndicator() {
  const el = document.createElement("div");
  el.className = "msg ai";
  el.id = "typing-indicator";
  el.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  autoResize();
  sendBtn.disabled = true;

  addMessage("user", text);
  history.push({ role: "user", content: text });

  addTypingIndicator();

  try {
    const response = await fetch(API_URL + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history })
    });

    if (!response.ok) throw new Error("Request failed");

    const data = await response.json();
    removeTypingIndicator();
    addMessage("ai", data.reply);
    history.push({ role: "assistant", content: data.reply });
  } catch (err) {
    removeTypingIndicator();
    addMessage("ai", "Error connecting to the server. Try again later.");
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

input.addEventListener("input", autoResize);

input.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function() {
    navigator.serviceWorker.register("/sw.js").catch(function() {});
  });
}

let deferredPrompt = null;
const installBtn = document.getElementById("install-btn");

window.addEventListener("beforeinstallprompt", function(e) {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = "flex";
});

if (installBtn) {
  installBtn.addEventListener("click", async function() {
    if (!deferredPrompt) return;
    installBtn.style.display = "none";
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
}

window.addEventListener("appinstalled", function() {
  if (installBtn) installBtn.style.display = "none";
});
