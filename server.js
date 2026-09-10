const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = "You are Psych AI, an assistant specialized in the Psych Engine fork of Friday Night Funkin', built with Haxe and HaxeFlixel. Help with Lua scripting, HScript, engine internals, mod creation, and debugging. Match the language the user writes in. Keep code examples accurate to the Psych Engine callback API.";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const rateLimitStore = new Map();

function rateLimit(maxRequests, windowMs) {
  return function(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    rateLimitStore.set(ip, entry);

    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "Too many requests, slow down a bit" });
    }

    next();
  };
}

setInterval(function() {
  const now = Date.now();
  rateLimitStore.forEach(function(entry, ip) {
    if (now > entry.resetAt + 60000) rateLimitStore.delete(ip);
  });
}, 60000);

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  if (messages.length > 60) return false;
  return messages.every(function(m) {
    return m && typeof m.role === "string" && typeof m.content === "string" && m.content.length <= 8000;
  });
}

app.get("/api/health", function(req, res) {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: Date.now() });
});

app.post("/api/chat", rateLimit(20, 60000), async function(req, res) {
  const messages = req.body.messages;

  if (!validateMessages(messages)) {
    return res.status(400).json({ error: "Invalid messages payload" });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
  }

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: req.body.model || ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: req.body.system || SYSTEM_PROMPT,
        stream: true,
        messages: messages
      })
    });
  } catch (err) {
    return res.status(502).json({ error: "Could not reach the AI provider" });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(function() { return ""; });
    return res.status(upstream.status).json({ error: text || "Upstream request failed" });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;

  req.on("close", function() {
    closed = true;
    reader.cancel().catch(function() {});
  });

  try {
    while (!closed) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (line.indexOf("data:") !== 0) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        try {
          const event = JSON.parse(dataStr);
          if (event.type === "content_block_delta" && event.delta && event.delta.text) {
            res.write(event.delta.text);
          }
          if (event.type === "error") {
            res.write("\n[error] " + (event.error && event.error.message ? event.error.message : "stream error"));
          }
        } catch (parseErr) {
          continue;
        }
      }
    }
  } catch (streamErr) {
    if (!closed) res.write("\n[error] stream interrupted");
  }

  res.end();
});

app.post("/api/title", rateLimit(30, 60000), async function(req, res) {
  const message = req.body.message;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message" });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 20,
        system: "Generate a short 3 to 6 word title summarizing the user message. Respond with only the title, no punctuation at the end, no quotes.",
        messages: [{ role: "user", content: message.slice(0, 500) }]
      })
    });

    const data = await upstream.json();
    const title = data.content && data.content[0] && data.content[0].text ? data.content[0].text.trim() : "";
    res.json({ title: title || message.slice(0, 42) });
  } catch (err) {
    res.json({ title: message.slice(0, 42) });
  }
});

app.get("*", function(req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, function() {
  console.log("Psych AI server running on port " + PORT);
});
