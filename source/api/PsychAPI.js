(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PsychAPI = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {

class PsychAPIError extends Error {
  constructor(type, message, status) {
    super(message);
    this.name = "PsychAPIError";
    this.type = type;
    this.status = status || null;
  }
}

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

class PsychAPI extends EventTarget {
  constructor(options) {
    super();
    options = options || {};
    this.baseUrl = options.baseUrl !== undefined ? options.baseUrl : "";
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.retryDelay = options.retryDelay || 800;
    this.model = options.model || null;
    this.systemPrompt = options.systemPrompt || null;
    this.online = true;
  }

  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    this.dispatchEvent(new CustomEvent("statuschange", { detail: { online: online } }));
  }

  buildUrl(path) {
    return this.baseUrl + path;
  }

  async request(path, body, options) {
    options = options || {};
    const attempts = options.retries !== undefined ? options.retries : this.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= attempts; attempt++) {
      try {
        const result = await this._singleRequest(path, body, options);
        this.setOnline(true);
        return result;
      } catch (err) {
        lastError = err;
        if (err.type === "aborted") throw err;
        if (err.type === "http" && err.status && err.status < 500) throw err;
        if (attempt < attempts) {
          this.dispatchEvent(new CustomEvent("retry", { detail: { attempt: attempt + 1, error: err } }));
          await wait(this.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    this.setOnline(false);
    throw lastError;
  }

  async _singleRequest(path, body, options) {
    const controller = options.signal ? null : new AbortController();
    const signal = options.signal || controller.signal;
    const timeoutId = setTimeout(function() {
      if (controller) controller.abort();
    }, options.timeout || this.timeout);

    let response;
    try {
      response = await fetch(this.buildUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new PsychAPIError("aborted", "Request was aborted or timed out");
      }
      throw new PsychAPIError("network", "Could not reach the Psych AI server");
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      let detail = "";
      try {
        const data = await response.clone().json();
        detail = data.error || "";
      } catch (parseErr) {
        detail = "";
      }
      throw new PsychAPIError("http", detail || ("Request failed with status " + response.status), response.status);
    }

    return response;
  }

  async chat(messages, options) {
    options = options || {};
    const payload = { messages: messages };
    if (this.model) payload.model = this.model;
    if (this.systemPrompt) payload.system = this.systemPrompt;

    const response = await this.request("/api/chat", payload, options);

    if (options.onChunk && response.body && response.body.getReader) {
      return this._streamResponse(response, options.onChunk);
    }

    const data = await response.json();
    return data.reply || "";
  }

  async _streamResponse(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const piece = decoder.decode(chunk.value, { stream: true });
      if (!piece) continue;
      fullText += piece;
      onChunk(piece, fullText);
    }

    return fullText;
  }

  async suggestTitle(firstMessage) {
    try {
      const response = await this._singleRequest("/api/title", { message: firstMessage }, { retries: 0, timeout: 8000 });
      const data = await response.json();
      if (data.title) return data.title;
    } catch (err) {
      // falls through to local fallback
    }
    const clean = firstMessage.trim().replace(/\s+/g, " ");
    return clean.length > 42 ? clean.slice(0, 42) + "..." : clean;
  }

  async health() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(function() { controller.abort(); }, 5000);
      const response = await fetch(this.buildUrl("/api/health"), { signal: controller.signal });
      clearTimeout(timeoutId);
      const healthy = response.ok;
      this.setOnline(healthy);
      return healthy;
    } catch (err) {
      this.setOnline(false);
      return false;
    }
  }

  startHealthPolling(intervalMs) {
    this.stopHealthPolling();
    const self = this;
    this._healthTimer = setInterval(function() {
      self.health();
    }, intervalMs || 30000);
    return this;
  }

  stopHealthPolling() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    return this;
  }
}

return {
  PsychAPI: PsychAPI,
  PsychAPIError: PsychAPIError
};

});
