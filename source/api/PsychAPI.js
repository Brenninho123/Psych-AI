(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PsychAPI = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {

class PsychAPIError extends Error {
  constructor(type, message, status, retryAfterMs) {
    super(message);
    this.name = "PsychAPIError";
    this.type = type;
    this.status = status || null;
    this.retryAfterMs = retryAfterMs || null;
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
    this.streamIdleTimeout = options.streamIdleTimeout || 15000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.retryDelay = options.retryDelay || 800;
    this.model = options.model || null;
    this.systemPrompt = options.systemPrompt || null;
    this.online = true;
    this._activeController = null;
  }

  setModel(model) {
    this.model = model;
    return this;
  }

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
    return this;
  }

  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    this.dispatchEvent(new CustomEvent("statuschange", { detail: { online: online } }));
  }

  cancel() {
    if (this._activeController) {
      this._activeController.abort();
      this._activeController = null;
      this.dispatchEvent(new CustomEvent("cancelled", { detail: {} }));
    }
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
        if (err.type === "http" && err.status && err.status < 500 && err.status !== 429) throw err;
        if (attempt < attempts) {
          const delay = err.retryAfterMs || (this.retryDelay * Math.pow(2, attempt));
          this.dispatchEvent(new CustomEvent("retry", { detail: { attempt: attempt + 1, error: err, delay: delay } }));
          await wait(delay);
        }
      }
    }

    this.setOnline(false);
    throw lastError;
  }

  async _singleRequest(path, body, options) {
    const controller = new AbortController();
    if (options.trackCancel) this._activeController = controller;
    const externalSignal = options.signal;

    const timeoutId = setTimeout(function() {
      controller.abort();
    }, options.timeout || this.timeout);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", function() { controller.abort(); });
    }

    let response;
    try {
      response = await fetch(this.buildUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new PsychAPIError("aborted", "Request was aborted or timed out");
      }
      throw new PsychAPIError("network", "Could not reach the Psych AI server");
    }
    clearTimeout(timeoutId);

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : null;
      throw new PsychAPIError("rate_limit", "Too many requests, slow down a bit", 429, retryAfterMs);
    }

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
    if (!options.parallel) this.cancel();

    const payload = { messages: messages };
    if (this.model) payload.model = this.model;
    if (this.systemPrompt) payload.system = this.systemPrompt;

    const requestOptions = Object.assign({}, options, { trackCancel: true });
    let response;

    try {
      response = await this.request("/api/chat", payload, requestOptions);
    } finally {
      this._activeController = null;
    }

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
    const self = this;

    async function readNext() {
      return Promise.race([
        reader.read(),
        wait(self.streamIdleTimeout).then(function() {
          throw new PsychAPIError("stream_timeout", "Stream stalled with no data");
        })
      ]);
    }

    try {
      while (true) {
        const chunk = await readNext();
        if (chunk.done) break;
        const piece = decoder.decode(chunk.value, { stream: true });
        if (!piece) continue;
        fullText += piece;
        onChunk(piece, fullText);
      }
    } catch (err) {
      reader.cancel().catch(function() {});
      if (fullText) return fullText;
      throw err;
    }

    return fullText;
  }

  async suggestTitle(firstMessage) {
    try {
      const response = await this._singleRequest("/api/title", { message: firstMessage }, { retries: 0, timeout: 8000 });
      const data = await response.json();
      if (data.title) return data.title;
    } catch (err) {
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
