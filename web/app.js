/**
 * app.js - Main Controller & Autonomous Agent Loop for Antigravity iOS.
 *
 * Implements:
 *   1. Google Account OAuth Login -> Tier Detection -> Dynamic Model Dropdown
 *   2. Agent Tool Execution Loop:
 *      - run_command (git clone, git status, git diff, mkdir, ls, cat, etc.)
 *      - read_file
 *      - write_file
 *      - edit_file
 *      - list_dir
 *      - ask_question (Interactive 1-Thumb /grill-me Choice Cards)
 *   3. New Folder & Folder Picker to point directly to any cloned repository on device.
 */
(function () {
  var chatCanvas = document.getElementById("chat-canvas");
  var promptInput = document.getElementById("prompt-input");
  var sendBtn = document.getElementById("send-btn");
  var modelSelect = document.getElementById("model-select");
  var activeFolderLabel = document.getElementById("active-folder-label");
  var accountBtn = document.getElementById("account-btn");
  var accountLabel = document.getElementById("account-label");
  var tierBadge = document.getElementById("tier-badge");

  var browsingPath = "";
  var conversationHistory = [];
  var isRunningTurn = false;

  var AGENT_TOOLS = [
    {
      name: "run_command",
      description:
        "Execute a shell or git command on the iOS device (supports: git clone <url> [dir], git status, git diff, mkdir -p, cd, ls, cat, rm, pwd).",
      parameters: {
        type: "OBJECT",
        properties: {
          command_line: {
            type: "STRING",
            description: "Exact command to execute (e.g. 'git clone https://github.com/user/repo.git')",
          },
        },
        required: ["command_line"],
      },
    },
    {
      name: "list_dir",
      description: "List files and subdirectories in a workspace folder on the device.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: {
            type: "STRING",
            description: "Relative or absolute directory path (empty for current workspace root).",
          },
        },
      },
    },
    {
      name: "read_file",
      description: "Read the contents of a file inside the selected workspace folder.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Path to the file to read." },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a file in the selected workspace folder.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Path to the file to write." },
          content: { type: "STRING", description: "Full text content to write." },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "edit_file",
      description: "Replace an exact target snippet in an existing file with replacement text.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Path to the file to modify." },
          target: { type: "STRING", description: "Exact target string to replace." },
          replacement: { type: "STRING", description: "Replacement string." },
        },
        required: ["path", "target", "replacement"],
      },
    },
    {
      name: "ask_question",
      description:
        "Ask the user a multiple-choice question with thumb-friendly clickable option cards (always use this tool when the user triggers /grill-me). Put your recommended option first prefixed with '(Recommended)'.",
      parameters: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING", description: "The question title to ask the user." },
          options: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "2 to 4 selectable option strings (first one prefixed with '(Recommended)').",
          },
        },
        required: ["question", "options"],
      },
    },
  ];

  function buildSystemPrompt() {
    var cwd = window.AgyGitShell.state.cwd || "~/Documents/projects";
    return [
      "You are Antigravity for iOS, an autonomous AI coding assistant running on the user's iOS device.",
      "Current active workspace directory on device: " + cwd,
      "Rules:",
      "1. Always respond in Vietnamese unless asked otherwise.",
      "2. When the user asks you to clone a git repository (e.g. 'git clone https://github.com/...'), immediately call the `run_command` tool with `git clone <url>`. Afterwards, remind the user they can tap '📂 Open Folder' at the top-left to select the newly cloned folder.",
      "3. When the user uses `/grill-me`, interview them one question at a time about their design/requirements by calling the `ask_question` tool with 2-4 clear options (prefix the first option with '(Recommended)').",
      "4. Keep responses concise and mobile-friendly for one-handed reading.",
    ].join("\n");
  }

  function updateAuthUI() {
    var auth = window.AgyCloudCode.loadSavedAuth();
    var infoBox = document.getElementById("account-info-box");
    if (!auth || !auth.access_token) {
      accountLabel.textContent = "Sign in";
      if (tierBadge) tierBadge.textContent = "Chưa đăng nhập Google OAuth";
      if (infoBox) {
        infoBox.innerHTML = "Chưa đăng nhập. Hãy bấm nút dưới để đăng nhập tài khoản Google của bạn.";
      }
      return;
    }

    var email = (auth.user && auth.user.email) || "Google Account";
    var tier = auth.tierName || "Free Tier";
    accountLabel.textContent = email.split("@")[0] + " • " + tier;
    if (tierBadge) {
      tierBadge.textContent = "✅ " + email + " (" + tier + ")";
    }
    if (infoBox) {
      infoBox.innerHTML =
        "<div><b>Tài khoản:</b> " +
        email +
        "</div><div><b>Gói Antigravity (Tier):</b> <span style='color:#38bdf8;font-weight:700;'>" +
        tier +
        "</span></div><div><b>Cloud Companion Project:</b> " +
        (auth.project || "(auto)") +
        "</div>";
    }

    if (auth.models && auth.models.length > 0) {
      var prev = modelSelect.value;
      modelSelect.innerHTML = "";
      auth.models.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label + (m.quota ? " (" + m.quota + ")" : "");
        modelSelect.appendChild(opt);
      });
      if (prev && auth.models.some(function (m) { return m.id === prev; })) {
        modelSelect.value = prev;
      } else if (auth.defaultModelId) {
        modelSelect.value = auth.defaultModelId;
      }
    }
  }

  function appendUserMessage(text) {
    var div = document.createElement("div");
    div.className = "msg user";
    div.textContent = text;
    chatCanvas.appendChild(div);
    chatCanvas.scrollTop = chatCanvas.scrollHeight;
  }

  function createAgentContainer() {
    var div = document.createElement("div");
    div.className = "msg agent";
    chatCanvas.appendChild(div);
    chatCanvas.scrollTop = chatCanvas.scrollHeight;
    return div;
  }

  function appendToolPill(container, title, output) {
    var pill = document.createElement("div");
    pill.className = "tool-pill";
    pill.innerHTML =
      '<div class="tool-pill-header"><span>' +
      title +
      '</span><span style="font-size:11px;color:#94a3b8;">Chi tiết ▾</span></div>' +
      '<div class="tool-pill-out"></div>';
    pill.querySelector(".tool-pill-out").textContent = output || "(done)";
    pill.querySelector(".tool-pill-header").addEventListener("click", function () {
      pill.classList.toggle("expanded");
    });
    container.appendChild(pill);
    chatCanvas.scrollTop = chatCanvas.scrollHeight;
  }

  function renderGrillCard(container, question, options) {
    return new Promise(function (resolve) {
      var card = document.createElement("div");
      card.className = "grill-card";
      var qEl = document.createElement("div");
      qEl.className = "grill-question";
      qEl.textContent = "🔥 " + question;
      card.appendChild(qEl);

      var optsWrap = document.createElement("div");
      optsWrap.className = "grill-options";

      (options || []).forEach(function (optText) {
        var btn = document.createElement("button");
        btn.className = "grill-opt-btn";
        btn.textContent = optText;
        btn.addEventListener("click", function () {
          optsWrap.querySelectorAll("button").forEach(function (b) {
            b.disabled = true;
            b.style.opacity = "0.5";
          });
          btn.style.opacity = "1";
          btn.style.borderColor = "#10b981";
          resolve(optText);
        });
        optsWrap.appendChild(btn);
      });

      // Custom write-in row
      var customRow = document.createElement("div");
      customRow.className = "new-folder-row";
      customRow.style.marginTop = "6px";
      customRow.innerHTML =
        '<input type="text" placeholder="Hoặc nhập câu trả lời khác..." />' +
        '<button class="action-btn primary">Chọn</button>';
      var inp = customRow.querySelector("input");
      var sub = customRow.querySelector("button");
      sub.addEventListener("click", function () {
        if (inp.value.trim()) {
          resolve(inp.value.trim());
        }
      });
      optsWrap.appendChild(customRow);

      card.appendChild(optsWrap);
      container.appendChild(card);
      chatCanvas.scrollTop = chatCanvas.scrollHeight;
    });
  }

  async function executeToolCall(call, agentDiv) {
    var name = call.name;
    var args = call.args || {};
    var ghToken = localStorage.getItem("agy_github_token") || "";
    var cwd = window.AgyGitShell.state.cwd;

    if (name === "run_command") {
      var cmd = args.command_line || "";
      var out = await window.AgyGitShell.executeShellCommand(cmd, ghToken);
      appendToolPill(agentDiv, "⚡ Lệnh: " + cmd, out);
      activeFolderLabel.textContent = shortenPath(window.AgyGitShell.state.cwd);
      return { output: out };
    }

    if (name === "list_dir") {
      var targetDir = args.path ? window.AgyGitShell.normPath(cwd, args.path) : cwd;
      var res = await window.AgyCloudCode.callNative("listDir", { path: targetDir });
      var listStr =
        res && res.ok
          ? (res.entries || [])
              .map(function (e) {
                return (e.isDir ? "[DIR] " : "[FILE] ") + e.name;
              })
              .join("\n")
          : "Error: " + ((res && res.error) || "cannot list");
      appendToolPill(agentDiv, "📁 Đọc thư mục: " + shortenPath(targetDir), listStr);
      return { entries: listStr };
    }

    if (name === "read_file") {
      var rPath = window.AgyGitShell.normPath(cwd, args.path);
      var rRes = await window.AgyCloudCode.callNative("readFile", { path: rPath });
      var content = rRes && rRes.ok ? rRes.content : "Error: " + ((rRes && rRes.error) || "not found");
      appendToolPill(agentDiv, "📄 Đọc file: " + args.path, content.slice(0, 1200));
      return { content: content };
    }

    if (name === "write_file") {
      var wPath = window.AgyGitShell.normPath(cwd, args.path);
      var wRes = await window.AgyCloudCode.callNative("writeFile", {
        path: wPath,
        content: args.content || "",
      });
      var wMsg = wRes && wRes.ok ? "Đã ghi file " + wPath : "Lỗi: " + (wRes && wRes.error);
      appendToolPill(agentDiv, "✏️ Ghi file: " + args.path, args.content || "");
      return { status: wMsg };
    }

    if (name === "edit_file") {
      var ePath = window.AgyGitShell.normPath(cwd, args.path);
      var orig = await window.AgyCloudCode.callNative("readFile", { path: ePath });
      if (!orig || !orig.ok) {
        return { error: "Không đọc được file " + ePath };
      }
      if (orig.content.indexOf(args.target) === -1) {
        return { error: "Không tìm thấy đoạn target trong " + args.path };
      }
      var updated = orig.content.replace(args.target, args.replacement);
      await window.AgyCloudCode.callNative("writeFile", { path: ePath, content: updated });
      var diffPreview = "--- Cũ ---\n" + args.target + "\n\n+++ Mới +++\n" + args.replacement;
      appendToolPill(agentDiv, "🛠️ Sửa file: " + args.path, diffPreview);
      return { status: "Updated " + args.path };
    }

    if (name === "ask_question") {
      var answer = await renderGrillCard(agentDiv, args.question, args.options);
      return { user_selected_answer: answer };
    }

    return { error: "Unknown tool " + name };
  }

  async function sendUserPrompt(text) {
    text = (text || "").trim();
    if (!text || isRunningTurn) return;

    promptInput.value = "";
    appendUserMessage(text);

    // Quick local shortcut: if user hasn't logged in yet and types a raw `git clone ...` command, execute directly!
    var auth = window.AgyCloudCode.loadSavedAuth();
    if ((!auth || !auth.access_token) && /^git\s+clone\s+/i.test(text)) {
      var localDiv = createAgentContainer();
      var ghTok = localStorage.getItem("agy_github_token") || "";
      var cmdOut = await window.AgyGitShell.executeShellCommand(text, ghTok);
      appendToolPill(localDiv, "⚡ " + text, cmdOut);
      var p = document.createElement("div");
      p.textContent = "Đã chạy lệnh clone trực tiếp trên thiết bị! Hãy bấm '📂 Open Folder' ở góc trái trên để trỏ vào repo vừa clone.";
      localDiv.appendChild(p);
      return;
    }

    isRunningTurn = true;
    sendBtn.disabled = true;

    conversationHistory.push({
      role: "user",
      parts: [{ text: text }],
    });

    var agentDiv = createAgentContainer();
    var statusEl = document.createElement("div");
    statusEl.style.color = "#38bdf8";
    statusEl.style.fontSize = "12px";
    statusEl.textContent = "🧠 Antigravity đang suy nghĩ...";
    agentDiv.appendChild(statusEl);

    try {
      for (var step = 0; step < 8; step++) {
        var turnRes = await window.AgyCloudCode.generateAgentTurn({
          model: modelSelect.value,
          contents: conversationHistory,
          systemInstruction: buildSystemPrompt(),
          tools: AGENT_TOOLS,
        });

        if (turnRes.thoughts) {
          var th = document.createElement("div");
          th.className = "thought-box";
          th.textContent = "💭 " + turnRes.thoughts.slice(0, 400);
          agentDiv.insertBefore(th, statusEl);
        }

        if (turnRes.text) {
          var txtEl = document.createElement("div");
          txtEl.style.whiteSpace = "pre-wrap";
          txtEl.textContent = turnRes.text;
          agentDiv.insertBefore(txtEl, statusEl);
        }

        var modelParts = [];
        if (turnRes.text) modelParts.push({ text: turnRes.text });
        (turnRes.functionCalls || []).forEach(function (fc) {
          modelParts.push({ functionCall: fc });
        });
        if (modelParts.length > 0) {
          conversationHistory.push({ role: "model", parts: modelParts });
        }

        if (!turnRes.functionCalls || turnRes.functionCalls.length === 0) {
          break;
        }

        var responseParts = [];
        for (var c = 0; c < turnRes.functionCalls.length; c++) {
          var fcItem = turnRes.functionCalls[c];
          statusEl.textContent = "⚡ Đang chạy " + fcItem.name + "...";
          var toolResult = await executeToolCall(fcItem, agentDiv);
          responseParts.push({
            functionResponse: {
              name: fcItem.name,
              response: toolResult,
            },
          });
        }

        conversationHistory.push({
          role: "user",
          parts: responseParts,
        });
      }
    } catch (err) {
      var errEl = document.createElement("div");
      errEl.style.color = "#f87171";
      errEl.textContent = "⚠️ " + (err.message || String(err));
      agentDiv.appendChild(errEl);
    } finally {
      statusEl.remove();
      isRunningTurn = false;
      sendBtn.disabled = false;
      chatCanvas.scrollTop = chatCanvas.scrollHeight;
    }
  }

  function shortenPath(p) {
    if (!p) return "~/Documents/projects";
    var docs = window.AgyGitShell.state.documentsPath;
    if (docs && p.startsWith(docs)) {
      var sub = p.slice(docs.length);
      return "~/Documents" + (sub || "");
    }
    return p;
  }

  // Folder Manager Modal
  async function renderFolderModal(dirPath) {
    browsingPath = dirPath || window.AgyGitShell.state.cwd || window.AgyGitShell.state.projectsPath;
    document.getElementById("modal-current-path").textContent = shortenPath(browsingPath);
    var listEl = document.getElementById("folder-list");
    listEl.innerHTML = "";

    // Parent folder '..' row
    if (browsingPath && browsingPath !== "/" && browsingPath !== window.AgyGitShell.state.documentsPath) {
      var upItem = document.createElement("div");
      upItem.className = "folder-item";
      upItem.innerHTML = "<span>⬆️ <b>.. (Lên thư mục cha)</b></span><span>Mở</span>";
      upItem.addEventListener("click", function () {
        var parent = browsingPath.split("/").slice(0, -1).join("/") || "/";
        renderFolderModal(parent);
      });
      listEl.appendChild(upItem);
    }

    var res = await window.AgyCloudCode.callNative("listDir", { path: browsingPath });
    if (!res || !res.ok) return;

    (res.entries || []).forEach(function (entry) {
      var row = document.createElement("div");
      row.className = "folder-item";
      if (entry.isDir) {
        row.innerHTML =
          "<span>📁 <b>" +
          entry.name +
          "</b></span><span style='color:#38bdf8;font-weight:600;'>Mở ➔</span>";
        row.addEventListener("click", function () {
          renderFolderModal(entry.path);
        });
      } else {
        row.innerHTML =
          "<span style='color:#94a3b8;'>📄 " +
          entry.name +
          "</span><span style='font-size:11px;color:#64748b;'>" +
          entry.size +
          " B</span>";
      }
      listEl.appendChild(row);
    });
  }

  // Wire UI Events
  sendBtn.addEventListener("click", function () {
    sendUserPrompt(promptInput.value);
  });

  promptInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserPrompt(promptInput.value);
    }
  });

  document.querySelectorAll(".chip[data-chip]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var prefix = chip.getAttribute("data-chip");
      promptInput.value = prefix + promptInput.value;
      promptInput.focus();
    });
  });

  document.getElementById("chip-clone-sample").addEventListener("click", function () {
    promptInput.value = "Chạy lệnh git clone https://github.com/";
    promptInput.focus();
  });

  document.getElementById("chip-files-view").addEventListener("click", function () {
    document.getElementById("folder-modal").classList.add("open");
    renderFolderModal(window.AgyGitShell.state.cwd);
  });

  document.getElementById("open-folder-btn").addEventListener("click", function () {
    document.getElementById("folder-modal").classList.add("open");
    renderFolderModal(window.AgyGitShell.state.cwd);
  });

  document.getElementById("close-folder-modal").addEventListener("click", function () {
    document.getElementById("folder-modal").classList.remove("open");
  });

  document.getElementById("select-this-folder-btn").addEventListener("click", function () {
    window.AgyGitShell.state.cwd = browsingPath;
    activeFolderLabel.textContent = shortenPath(browsingPath);
    document.getElementById("folder-modal").classList.remove("open");
  });

  document.getElementById("create-folder-btn").addEventListener("click", async function () {
    var inp = document.getElementById("new-folder-input");
    var name = inp.value.trim();
    if (!name) return;
    var newPath = window.AgyGitShell.normPath(browsingPath, name);
    await window.AgyCloudCode.callNative("mkdir", { path: newPath });
    inp.value = "";
    renderFolderModal(newPath);
  });

  document.getElementById("ios-native-picker-btn").addEventListener("click", async function () {
    var res = await window.AgyCloudCode.callNative("pickExternalFolder", {});
    if (res && res.ok && res.path) {
      window.AgyGitShell.state.cwd = res.path;
      activeFolderLabel.textContent = shortenPath(res.path);
      document.getElementById("folder-modal").classList.remove("open");
    }
  });

  accountBtn.addEventListener("click", function () {
    document.getElementById("github-token-input").value =
      localStorage.getItem("agy_github_token") || "";
    updateAuthUI();
    document.getElementById("account-modal").classList.add("open");
  });

  document.getElementById("close-account-modal").addEventListener("click", function () {
    document.getElementById("account-modal").classList.remove("open");
  });

  document.getElementById("google-signin-btn").addEventListener("click", async function () {
    var btn = document.getElementById("google-signin-btn");
    btn.textContent = "⏳ Đang mở Google OAuth...";
    try {
      await window.AgyCloudCode.signInWithGoogle();
      updateAuthUI();
      document.getElementById("account-modal").classList.remove("open");
    } catch (e) {
      alert("Đăng nhập thất bại: " + (e.message || e));
    } finally {
      btn.textContent = "🌐 Sign in with Google";
    }
  });

  document.getElementById("refresh-models-btn").addEventListener("click", async function () {
    await window.AgyCloudCode.syncAccountTierAndModels();
    updateAuthUI();
  });

  document.getElementById("save-gh-token-btn").addEventListener("click", function () {
    var v = document.getElementById("github-token-input").value.trim();
    localStorage.setItem("agy_github_token", v);
    alert("Đã lưu GitHub Token!");
  });

  // Boot
  window.AgyGitShell.initEnv().then(function (st) {
    activeFolderLabel.textContent = shortenPath(st.cwd);
    updateAuthUI();
  });
})();
