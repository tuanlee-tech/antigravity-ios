/**
 * cloudcode_client.js - Authentic Google Antigravity OAuth & Cloud Code v1internal Client for iOS.
 *
 * Connects directly to Google Antigravity's backend (`https://daily-cloudcode-pa.googleapis.com`):
 *   - Google OAuth 2.0 Sign-In (Client ID: 1071006060591-tmhssin2h21lcre235vtolojh4g403ep...)
 *   - /v1internal:loadCodeAssist & /v1internal:onboardUser -> Detects user's Account Tier & Companion Project
 *   - /v1internal:fetchAvailableModels -> Dynamically populates available models for the user's Google Account Tier
 *   - /v1internal:streamGenerateContent?alt=sse -> Executes multi-turn agentic coding with tool calls
 */
(function (global) {
  var CLOUDCODE_BASE = "https://daily-cloudcode-pa.googleapis.com";
  var STORAGE_KEY = "agy_ios_oauth_state_v1";
  var OAUTH_CFG_KEY = "agy_ios_oauth_cfg_v1";
  var runtimeOAuthCfg = { clientId: "", clientSecret: "" };

  function getOAuthConfig() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(OAUTH_CFG_KEY) || "{}");
    } catch (e) {}
    return {
      clientId: (saved.clientId || runtimeOAuthCfg.clientId || "").trim(),
      clientSecret: (saved.clientSecret || runtimeOAuthCfg.clientSecret || "").trim(),
    };
  }

  function setRuntimeOAuthConfig(clientId, clientSecret) {
    if (clientId) runtimeOAuthCfg.clientId = clientId;
    if (clientSecret) runtimeOAuthCfg.clientSecret = clientSecret;
  }

  function saveUserOAuthConfig(clientId, clientSecret) {
    localStorage.setItem(
      OAUTH_CFG_KEY,
      JSON.stringify({
        clientId: (clientId || "").trim(),
        clientSecret: (clientSecret || "").trim(),
      })
    );
  }

  var pendingCallbacks = {};
  var cbCounter = 0;

  global.__onAgyNativeCallback = function (response, callbackId) {
    var fn = pendingCallbacks[callbackId];
    if (fn) {
      delete pendingCallbacks[callbackId];
      fn(response);
    }
  };

  function callNative(action, payload) {
    if (
      global.webkit &&
      global.webkit.messageHandlers &&
      global.webkit.messageHandlers.agyNative
    ) {
      return new Promise(function (resolve) {
        var id = "cb_" + ++cbCounter + "_" + Date.now();
        pendingCallbacks[id] = resolve;
        global.webkit.messageHandlers.agyNative.postMessage({
          callbackId: id,
          action: action,
          payload: payload || {},
        });
      });
    }
    // Fallback to local dev preview bridge (/api/native) when testing on Linux/macOS browser
    return fetch("/api/native", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, payload: payload || {} }),
    }).then(function (r) {
      return r.json();
    });
  }

  function nativeHttp(url, options) {
    options = options || {};
    return callNative("httpProxy", {
      url: url,
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || undefined,
      bodyBase64: options.bodyBase64 || undefined,
      responseType: options.responseType || "text",
    });
  }

  function loadSavedAuth() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveAuth(state) {
    if (!state) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  async function ensureValidAccessToken() {
    var auth = loadSavedAuth();
    if (!auth || !auth.access_token) return null;

    var now = Date.now();
    if (auth.expires_at && now < auth.expires_at - 60000) {
      return auth.access_token;
    }
    if (!auth.refresh_token) return auth.access_token;

    var cfg = getOAuthConfig();
    var form =
      "client_id=" +
      encodeURIComponent(cfg.clientId) +
      (cfg.clientSecret ? "&client_secret=" + encodeURIComponent(cfg.clientSecret) : "") +
      "&refresh_token=" +
      encodeURIComponent(auth.refresh_token) +
      "&grant_type=refresh_token";

    var res = await nativeHttp("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });

    if (res && res.ok && res.status === 200) {
      var data = JSON.parse(res.body);
      if (data.access_token) {
        auth.access_token = data.access_token;
        auth.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
        saveAuth(auth);
        return auth.access_token;
      }
    }
    return auth.access_token;
  }

  async function signInWithGoogle() {
    var cfg = getOAuthConfig();
    var res = await callNative("startGoogleOAuth", {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });
    if (!res || !res.ok || !res.token) {
      throw new Error((res && res.error) || "Google OAuth Sign-In failed");
    }
    var tok = res.token;
    var auth = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || "",
      expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
      user: null,
      tierName: "Free Tier",
      tierId: "free-tier",
      project: "",
      models: [],
    };

    // 1. Fetch Google user profile
    var uRes = await nativeHttp("https://www.googleapis.com/oauth2/v2/userinfo", {
      method: "GET",
      headers: { Authorization: "Bearer " + auth.access_token },
    });
    if (uRes && uRes.ok && uRes.status === 200) {
      try {
        auth.user = JSON.parse(uRes.body);
      } catch (e) {}
    }

    saveAuth(auth);
    // 2. Discover Antigravity Account Tier & Available Models from Cloud Code
    await syncAccountTierAndModels();
    return loadSavedAuth();
  }

  async function syncAccountTierAndModels() {
    var token = await ensureValidAccessToken();
    var auth = loadSavedAuth();
    if (!token || !auth) return null;

    var clientMetadata = {
      ideType: "ANTIGRAVITY",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    };

    // Step 1: Call /v1internal:loadCodeAssist
    var loadRes = await nativeHttp(CLOUDCODE_BASE + "/v1internal:loadCodeAssist", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "antigravity/2.33.0",
      },
      body: JSON.stringify({
        metadata: clientMetadata,
        mode: "FULL_ELIGIBILITY_CHECK",
      }),
    });

    if (loadRes && loadRes.ok && loadRes.status === 200) {
      try {
        var loadData = JSON.parse(loadRes.body);
        if (loadData.currentTier) {
          auth.tierId = loadData.currentTier.id || auth.tierId;
          auth.tierName = loadData.currentTier.name || auth.tierName;
        } else if (loadData.allowedTiers && loadData.allowedTiers.length > 0) {
          var defTier =
            loadData.allowedTiers.find(function (t) { return t.isDefault; }) ||
            loadData.allowedTiers[0];
          auth.tierId = defTier.id || "free-tier";
          auth.tierName = defTier.name || "Free Tier";
        }
        if (loadData.cloudaicompanionProject) {
          auth.project =
            typeof loadData.cloudaicompanionProject === "string"
              ? loadData.cloudaicompanionProject
              : loadData.cloudaicompanionProject.id || "";
        }

        // If project is not yet provisioned, call /v1internal:onboardUser
        if (!auth.project) {
          var onbRes = await nativeHttp(CLOUDCODE_BASE + "/v1internal:onboardUser", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
              "User-Agent": "antigravity/2.33.0",
            },
            body: JSON.stringify({
              tierId: auth.tierId,
              metadata: clientMetadata,
            }),
          });
          if (onbRes && onbRes.ok && onbRes.status === 200) {
            var onbData = JSON.parse(onbRes.body);
            var respObj = onbData.response || onbData;
            if (respObj.cloudaicompanionProject) {
              auth.project =
                typeof respObj.cloudaicompanionProject === "string"
                  ? respObj.cloudaicompanionProject
                  : respObj.cloudaicompanionProject.id || "";
            }
          }
        }
      } catch (e) {}
    }

    // Step 2: Call /v1internal:fetchAvailableModels to get models for this user's tier
    var modelsPayload = auth.project ? { project: auth.project } : {};
    var modRes = await nativeHttp(CLOUDCODE_BASE + "/v1internal:fetchAvailableModels", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "antigravity/2.33.0",
      },
      body: JSON.stringify(modelsPayload),
    });

    var parsedModels = [];
    if (modRes && modRes.ok && modRes.status === 200) {
      try {
        var modData = JSON.parse(modRes.body);
        var modelsMap = modData.models || {};
        Object.keys(modelsMap).forEach(function (modelId) {
          var m = modelsMap[modelId];
          var quota =
            m.quotaInfo && typeof m.quotaInfo.remainingFraction === "number"
              ? Math.round(m.quotaInfo.remainingFraction * 100) + "%"
              : "100%";
          parsedModels.push({
            id: modelId,
            label: m.displayName || modelId,
            quota: quota,
            supportsThinking: Boolean(m.supportsThinking),
          });
        });
        if (modData.defaultAgentModelId) {
          auth.defaultModelId = modData.defaultAgentModelId;
        }
      } catch (e) {}
    }

    if (parsedModels.length > 0) {
      auth.models = parsedModels;
    }
    saveAuth(auth);
    return auth;
  }

  /**
   * Calls Antigravity Cloud Code /v1internal:streamGenerateContent?alt=sse (or generateContent)
   */
  async function generateAgentTurn(params) {
    var token = await ensureValidAccessToken();
    var auth = loadSavedAuth();
    if (!token || !auth) {
      throw new Error("Vui lòng bấm 'Sign in with Google' để đăng nhập tài khoản Antigravity trước.");
    }

    var modelId = params.model || auth.defaultModelId || "gemini-2.5-flash";
    var payload = {
      project: auth.project || "",
      model: modelId,
      userAgent: "antigravity",
      requestId: "agy-ios-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      request: {
        contents: params.contents,
        systemInstruction: {
          role: "user",
          parts: [{ text: params.systemInstruction }],
        },
        tools: [{ functionDeclarations: params.tools }],
        generationConfig: {
          temperature: 0.2,
        },
      },
    };

    var res = await nativeHttp(
      CLOUDCODE_BASE + "/v1internal:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": "antigravity/2.33.0",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res || !res.ok || res.status >= 400) {
      var errText = (res && (res.body || res.error)) || "HTTP " + (res && res.status);
      throw new Error("Antigravity CloudCode Error: " + errText.slice(0, 400));
    }

    // Parse SSE data lines from streamGenerateContent
    var combinedText = "";
    var combinedThoughts = "";
    var functionCalls = [];
    var rawBody = res.body || "";
    var lines = rawBody.split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line.startsWith("data:")) continue;
      var jsonPart = line.slice(5).trim();
      if (!jsonPart || jsonPart === "[DONE]") continue;
      try {
        var evt = JSON.parse(jsonPart);
        var inner = evt.response || evt;
        var candidates = inner.candidates || [];
        if (candidates[0] && candidates[0].content && candidates[0].content.parts) {
          var parts = candidates[0].content.parts;
          for (var p = 0; p < parts.length; p++) {
            var part = parts[p];
            if (part.thought && part.text) {
              combinedThoughts += part.text;
            } else if (typeof part.text === "string") {
              combinedText += part.text;
            }
            if (part.functionCall) {
              functionCalls.push(part.functionCall);
            }
          }
        }
      } catch (e) {}
    }

    return {
      text: combinedText,
      thoughts: combinedThoughts,
      functionCalls: functionCalls,
    };
  }

  global.AgyCloudCode = {
    callNative: callNative,
    nativeHttp: nativeHttp,
    getOAuthConfig: getOAuthConfig,
    setRuntimeOAuthConfig: setRuntimeOAuthConfig,
    saveUserOAuthConfig: saveUserOAuthConfig,
    loadSavedAuth: loadSavedAuth,
    saveAuth: saveAuth,
    signInWithGoogle: signInWithGoogle,
    syncAccountTierAndModels: syncAccountTierAndModels,
    generateAgentTurn: generateAgentTurn,
  };
})(window);
