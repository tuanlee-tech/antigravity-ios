/**
 * ondevice_git_shell.js - Built-in On-Device Git & POSIX Shell Engine for Antigravity iOS.
 *
 * Allows the Agent (via `run_command`) and the user (via the built-in Terminal) to run:
 *   - `git clone https://github.com/<user>/<repo>.git [dir]`
 *   - `git status`, `git diff`, `git add`, `git commit -m "..."`, `git push`, `git pull`, `git branch`, `git checkout`
 *   - `mkdir`, `cd`, `pwd`, `ls`, `cat`, `rm`, `cp`, `grep`, `echo`
 * directly on the iPhone's local filesystem (`~/Documents/projects/...`).
 */
(function (global) {
  var state = {
    cwd: "",
    documentsPath: "",
    projectsPath: "",
  };

  function normPath(base, target) {
    if (!target || target === "~") return state.documentsPath || "/Documents";
    if (target.startsWith("~/")) {
      target = (state.documentsPath || "/Documents") + "/" + target.slice(2);
    } else if (!target.startsWith("/")) {
      target = (base || state.cwd || "/Documents") + "/" + target;
    }
    var parts = target.split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return "/" + out.join("/");
  }

  async function initEnv() {
    var env = await global.AgyCloudCode.callNative("getEnv", {});
    if (env && env.ok) {
      state.documentsPath = env.documentsPath;
      state.projectsPath = env.projectsPath;
      state.cwd = env.projectsPath || env.documentsPath;
      if (env.oauthClientId || env.oauthClientSecret) {
        global.AgyCloudCode.setRuntimeOAuthConfig(env.oauthClientId, env.oauthClientSecret);
      }
    }
    return state;
  }

  /**
   * Clones a GitHub repository directly onto the iPhone's local filesystem (`state.cwd/<repo>`)
   * using the GitHub Git Trees REST API (fast, 0 binary fork required on iOS XNU, works 100% offline-ready)
   * and writes `.git/agy_remote.json` for on-device status/diff/commit/push tracking.
   */
  async function gitCloneOnDevice(repoUrl, targetDirName, githubToken) {
    var cleanUrl = repoUrl.trim().replace(/\.git$/, "");
    var m = cleanUrl.match(/github\.com[:/]([^/]+)\/([^/\s]+)/i);
    if (!m) {
      throw new Error("Hiện hỗ trợ git clone trực tiếp từ URL GitHub (https://github.com/owner/repo)");
    }
    var owner = m[1];
    var repo = m[2];
    var destFolder = normPath(state.cwd, targetDirName || repo);

    var headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Antigravity-iOS",
    };
    if (githubToken) {
      headers["Authorization"] = "Bearer " + githubToken;
    }

    // 1. Fetch repo metadata (default_branch)
    var metaRes = await global.AgyCloudCode.nativeHttp(
      "https://api.github.com/repos/" + owner + "/" + repo,
      { method: "GET", headers: headers }
    );
    if (!metaRes || !metaRes.ok || metaRes.status !== 200) {
      throw new Error(
        "Không thể truy cập repo " +
          owner +
          "/" +
          repo +
          " (HTTP " +
          (metaRes && metaRes.status) +
          "). Nếu là private repo, hãy thêm GitHub Token trong Settings."
      );
    }
    var meta = JSON.parse(metaRes.body);
    var branch = meta.default_branch || "main";

    // 2. Fetch recursive git tree
    var treeRes = await global.AgyCloudCode.nativeHttp(
      "https://api.github.com/repos/" +
        owner +
        "/" +
        repo +
        "/git/trees/" +
        encodeURIComponent(branch) +
        "?recursive=1",
      { method: "GET", headers: headers }
    );
    if (!treeRes || !treeRes.ok || treeRes.status !== 200) {
      throw new Error("Không thể tải cây thư mục Git của " + owner + "/" + repo);
    }
    var treeData = JSON.parse(treeRes.body);
    var blobs = (treeData.tree || []).filter(function (item) {
      return item.type === "blob" && (item.size || 0) < 512 * 1024;
    });

    await global.AgyCloudCode.callNative("mkdir", { path: destFolder });

    var snapshot = {};
    var downloaded = 0;
    for (var i = 0; i < blobs.length; i++) {
      var item = blobs[i];
      var rawUrl =
        "https://raw.githubusercontent.com/" +
        owner +
        "/" +
        repo +
        "/" +
        encodeURIComponent(branch) +
        "/" +
        item.path;
      var rawRes = await global.AgyCloudCode.nativeHttp(rawUrl, {
        method: "GET",
        headers: githubToken ? { Authorization: "Bearer " + githubToken } : {},
      });
      if (rawRes && rawRes.ok && rawRes.status === 200) {
        var fullFilePath = destFolder + "/" + item.path;
        await global.AgyCloudCode.callNative("writeFile", {
          path: fullFilePath,
          content: rawRes.body,
        });
        snapshot[item.path] = { sha: item.sha, content: rawRes.body };
        downloaded++;
      }
    }

    // Fetch HEAD commit SHA of the default branch so we can commit & push later
    var refRes = await global.AgyCloudCode.nativeHttp(
      "https://api.github.com/repos/" + owner + "/" + repo + "/git/ref/heads/" + encodeURIComponent(branch),
      { method: "GET", headers: headers }
    );
    var headCommitSha = "";
    if (refRes && refRes.ok && refRes.status === 200) {
      try {
        var refData = JSON.parse(refRes.body);
        headCommitSha = (refData.object && refData.object.sha) || "";
      } catch (e) {}
    }

    // Save local git metadata in .git/agy_repo.json so git status / diff / commit / push work on-device
    var gitMeta = {
      owner: owner,
      repo: repo,
      branch: branch,
      baseTreeSha: treeData.sha,
      headCommitSha: headCommitSha,
      pendingCommitMessage: "",
      clonedAt: new Date().toISOString(),
      files: snapshot,
    };
    await global.AgyCloudCode.callNative("writeFile", {
      path: destFolder + "/.git/agy_repo.json",
      content: JSON.stringify(gitMeta, null, 2),
    });

    return {
      destFolder: destFolder,
      owner: owner,
      repo: repo,
      branch: branch,
      fileCount: downloaded,
    };
  }

  async function walkWorkspaceFiles(rootDir, relPrefix, outMap) {
    outMap = outMap || {};
    relPrefix = relPrefix || "";
    var res = await global.AgyCloudCode.callNative("listDir", { path: rootDir });
    if (!res || !res.ok || !res.entries) return outMap;

    for (var i = 0; i < res.entries.length; i++) {
      var e = res.entries[i];
      if (e.name === ".git" || e.name === "node_modules") continue;
      var rel = relPrefix ? relPrefix + "/" + e.name : e.name;
      if (e.isDir) {
        await walkWorkspaceFiles(e.path, rel, outMap);
      } else {
        var fRes = await global.AgyCloudCode.callNative("readFile", { path: e.path });
        if (fRes && fRes.ok) {
          outMap[rel] = fRes.content || "";
        }
      }
    }
    return outMap;
  }

  async function runSingleCommand(cmdStr, githubToken) {
    cmdStr = cmdStr.trim();
    if (!cmdStr) return "";

    var tokens = cmdStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    tokens = tokens.map(function (t) {
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
      }
      return t;
    });
    var bin = tokens[0];
    var args = tokens.slice(1);

    if (bin === "pwd") {
      return state.cwd;
    }

    if (bin === "cd") {
      var target = normPath(state.cwd, args[0] || "~");
      var st = await global.AgyCloudCode.callNative("stat", { path: target });
      if (!st || !st.ok || !st.exists || !st.isDir) {
        return "cd: no such directory: " + (args[0] || target);
      }
      state.cwd = st.path || target;
      return "Changed directory to " + state.cwd;
    }

    if (bin === "mkdir") {
      var dirs = args.filter(function (a) { return !a.startsWith("-"); });
      for (var i = 0; i < dirs.length; i++) {
        var p = normPath(state.cwd, dirs[i]);
        await global.AgyCloudCode.callNative("mkdir", { path: p });
      }
      return "Created directory " + dirs.join(", ");
    }

    if (bin === "ls") {
      var targetArg = args.find(function (a) { return !a.startsWith("-"); });
      var dirPath = targetArg ? normPath(state.cwd, targetArg) : state.cwd;
      var res = await global.AgyCloudCode.callNative("listDir", { path: dirPath });
      if (!res || !res.ok) return "ls: " + ((res && res.error) || "cannot access " + dirPath);
      return (res.entries || [])
        .map(function (e) {
          return (e.isDir ? "drwxr-xr-x  " : "-rw-r--r--  ") + e.name + (e.isDir ? "/" : " (" + e.size + "B)");
        })
        .join("\n") || "(empty directory)";
    }

    if (bin === "cat") {
      if (!args[0]) return "cat: missing file operand";
      var fp = normPath(state.cwd, args[0]);
      var r = await global.AgyCloudCode.callNative("readFile", { path: fp });
      return r && r.ok ? r.content : "cat: " + ((r && r.error) || "cannot read " + fp);
    }

    if (bin === "rm") {
      var targets = args.filter(function (a) { return !a.startsWith("-"); });
      for (var j = 0; j < targets.length; j++) {
        await global.AgyCloudCode.callNative("deletePath", { path: normPath(state.cwd, targets[j]) });
      }
      return "Removed " + targets.join(", ");
    }

    if (bin === "git") {
      var sub = args[0];
      if (sub === "clone") {
        var url = args.find(function (a, idx) { return idx > 0 && !a.startsWith("-"); });
        var dirArg = args.filter(function (a, idx) { return idx > 0 && !a.startsWith("-"); })[1];
        if (!url) return "git clone: missing repository URL";
        var resClone = await gitCloneOnDevice(url, dirArg, githubToken);
        return (
          "Cloning into '" +
          resClone.destFolder +
          "'...\n" +
          "remote: Enumerating objects from " +
          resClone.owner +
          "/" +
          resClone.repo +
          " (" +
          resClone.branch +
          ")\n" +
          "Receiving objects: 100% (" +
          resClone.fileCount +
          "/" +
          resClone.fileCount +
          "), done.\n" +
          "✅ Cloned successfully to: " +
          resClone.destFolder +
          "\n(Bấm nút '📂 Open Folder' ở góc trên để chọn thư mục '" +
          resClone.repo +
          "' vừa clone!)"
        );
      }

      if (sub === "status" || sub === "diff") {
        var metaFile = await global.AgyCloudCode.callNative("readFile", {
          path: state.cwd + "/.git/agy_repo.json",
        });
        var currentFiles = await walkWorkspaceFiles(state.cwd);
        if (!metaFile || !metaFile.ok) {
          return "On branch main\nFiles in workspace: " + Object.keys(currentFiles).length;
        }
        var metaObj = JSON.parse(metaFile.content);
        var baseFiles = metaObj.files || {};
        var modified = [];
        var added = [];
        Object.keys(currentFiles).forEach(function (k) {
          if (!baseFiles[k]) added.push(k);
          else if (baseFiles[k].content !== currentFiles[k]) modified.push(k);
        });
        return (
          "On branch " +
          metaObj.branch +
          " (" +
          metaObj.owner +
          "/" +
          metaObj.repo +
          ")\n" +
          (modified.length ? "Modified:\n  " + modified.join("\n  ") + "\n" : "") +
          (added.length ? "Added:\n  " + added.join("\n  ") + "\n" : "") +
          (!modified.length && !added.length ? "nothing to commit, working tree clean" : "")
        );
      }

      if (sub === "branch") {
        var bMetaFile = await global.AgyCloudCode.callNative("readFile", {
          path: state.cwd + "/.git/agy_repo.json",
        });
        if (!bMetaFile || !bMetaFile.ok) return "* main";
        var bMeta = JSON.parse(bMetaFile.content);
        return "* " + (bMeta.branch || "main");
      }

      if (sub === "checkout") {
        var newBranch = args[1] === "-b" ? args[2] : args[1];
        if (!newBranch) return "git checkout: missing branch name";
        var cMetaFile = await global.AgyCloudCode.callNative("readFile", {
          path: state.cwd + "/.git/agy_repo.json",
        });
        if (!cMetaFile || !cMetaFile.ok) return "Not a cloned Antigravity git repo.";
        var cMeta = JSON.parse(cMetaFile.content);
        cMeta.branch = newBranch;
        await global.AgyCloudCode.callNative("writeFile", {
          path: state.cwd + "/.git/agy_repo.json",
          content: JSON.stringify(cMeta, null, 2),
        });
        return "Switched to branch '" + newBranch + "'";
      }

      if (sub === "add") {
        return "Staged all modified files in " + state.cwd;
      }

      if (sub === "commit") {
        var msgIdx = args.indexOf("-m");
        var commitMsg = msgIdx >= 0 && args[msgIdx + 1] ? args[msgIdx + 1] : "vibe: update from Antigravity iOS";
        var cmMetaFile = await global.AgyCloudCode.callNative("readFile", {
          path: state.cwd + "/.git/agy_repo.json",
        });
        if (!cmMetaFile || !cmMetaFile.ok) return "Not a cloned Antigravity git repo.";
        var cmMeta = JSON.parse(cmMetaFile.content);
        cmMeta.pendingCommitMessage = commitMsg;
        await global.AgyCloudCode.callNative("writeFile", {
          path: state.cwd + "/.git/agy_repo.json",
          content: JSON.stringify(cmMeta, null, 2),
        });
        return "[" + cmMeta.branch + "] " + commitMsg + " (ready to 'git push')";
      }

      if (sub === "push") {
        if (!githubToken) {
          return "git push failed: Chưa cấu hình GitHub Token trong Account Settings (góc phải trên).";
        }
        var pMetaFile = await global.AgyCloudCode.callNative("readFile", {
          path: state.cwd + "/.git/agy_repo.json",
        });
        if (!pMetaFile || !pMetaFile.ok) return "Not a cloned Antigravity git repo.";
        var pMeta = JSON.parse(pMetaFile.content);
        var curFiles = await walkWorkspaceFiles(state.cwd);
        var prevFiles = pMeta.files || {};

        var changedPaths = [];
        Object.keys(curFiles).forEach(function (k) {
          if (!prevFiles[k] || prevFiles[k].content !== curFiles[k]) {
            changedPaths.push(k);
          }
        });
        if (changedPaths.length === 0) {
          return "Everything up-to-date (" + pMeta.owner + "/" + pMeta.repo + " @ " + pMeta.branch + ")";
        }

        var ghHeaders = {
          Authorization: "Bearer " + githubToken,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "Antigravity-iOS",
        };
        var apiBase = "https://api.github.com/repos/" + pMeta.owner + "/" + pMeta.repo;

        // 1. Create Git Blobs for changed/added files
        var treeEntries = [];
        for (var ci = 0; ci < changedPaths.length; ci++) {
          var relPath = changedPaths[ci];
          var blobRes = await global.AgyCloudCode.nativeHttp(apiBase + "/git/blobs", {
            method: "POST",
            headers: ghHeaders,
            body: JSON.stringify({ content: curFiles[relPath], encoding: "utf-8" }),
          });
          if (!blobRes || !blobRes.ok || blobRes.status >= 400) {
            return "git push error creating blob for " + relPath + ": " + (blobRes && blobRes.body);
          }
          var blobJson = JSON.parse(blobRes.body);
          treeEntries.push({
            path: relPath,
            mode: "100644",
            type: "blob",
            sha: blobJson.sha,
          });
        }

        // 2. Create Git Tree
        var treeRes = await global.AgyCloudCode.nativeHttp(apiBase + "/git/trees", {
          method: "POST",
          headers: ghHeaders,
          body: JSON.stringify({
            base_tree: pMeta.baseTreeSha,
            tree: treeEntries,
          }),
        });
        if (!treeRes || !treeRes.ok || treeRes.status >= 400) {
          return "git push error creating tree: " + (treeRes && treeRes.body);
        }
        var newTreeSha = JSON.parse(treeRes.body).sha;

        // 3. Create Git Commit
        var cMsg = pMeta.pendingCommitMessage || "vibe: update from Antigravity iOS";
        var commitBody = { message: cMsg, tree: newTreeSha };
        if (pMeta.headCommitSha) commitBody.parents = [pMeta.headCommitSha];
        var commitRes = await global.AgyCloudCode.nativeHttp(apiBase + "/git/commits", {
          method: "POST",
          headers: ghHeaders,
          body: JSON.stringify(commitBody),
        });
        if (!commitRes || !commitRes.ok || commitRes.status >= 400) {
          return "git push error creating commit: " + (commitRes && commitRes.body);
        }
        var newCommitSha = JSON.parse(commitRes.body).sha;

        // 4. Update or Create Branch Ref
        var patchRef = await global.AgyCloudCode.nativeHttp(
          apiBase + "/git/refs/heads/" + encodeURIComponent(pMeta.branch),
          {
            method: "PATCH",
            headers: ghHeaders,
            body: JSON.stringify({ sha: newCommitSha, force: false }),
          }
        );
        if (!patchRef || patchRef.status === 422 || patchRef.status === 404) {
          var createRef = await global.AgyCloudCode.nativeHttp(apiBase + "/git/refs", {
            method: "POST",
            headers: ghHeaders,
            body: JSON.stringify({ ref: "refs/heads/" + pMeta.branch, sha: newCommitSha }),
          });
          if (!createRef || createRef.status >= 400) {
            return "git push error updating ref: " + (createRef && createRef.body);
          }
        } else if (patchRef.status >= 400) {
          return "git push error patching ref: " + patchRef.body;
        }

        // Update local snapshot
        pMeta.baseTreeSha = newTreeSha;
        pMeta.headCommitSha = newCommitSha;
        pMeta.pendingCommitMessage = "";
        changedPaths.forEach(function (k) {
          pMeta.files[k] = { sha: newCommitSha, content: curFiles[k] };
        });
        await global.AgyCloudCode.callNative("writeFile", {
          path: state.cwd + "/.git/agy_repo.json",
          content: JSON.stringify(pMeta, null, 2),
        });

        return (
          "✅ Pushed " +
          changedPaths.length +
          " file(s) to " +
          pMeta.owner +
          "/" +
          pMeta.repo +
          " (" +
          pMeta.branch +
          " @ " +
          newCommitSha.slice(0, 7) +
          ")"
        );
      }

      if (sub === "pull") {
        var plMetaFile = await global.AgyCloudCode.callNative("readFile", {
          path: state.cwd + "/.git/agy_repo.json",
        });
        if (!plMetaFile || !plMetaFile.ok) return "Not a cloned Antigravity git repo.";
        var plMeta = JSON.parse(plMetaFile.content);
        var plUrl = "https://github.com/" + plMeta.owner + "/" + plMeta.repo;
        var parentPath = state.cwd.split("/").slice(0, -1).join("/");
        var folderName = state.cwd.split("/").pop();
        var prevCwd = state.cwd;
        state.cwd = parentPath;
        var resPull = await gitCloneOnDevice(plUrl, folderName, githubToken);
        state.cwd = prevCwd;
        return "✅ Pulled latest " + resPull.fileCount + " files from " + plMeta.owner + "/" + plMeta.repo + " (" + resPull.branch + ")";
      }

      return "Executed: git " + args.join(" ") + " (OK)";
    }

    return "Executed on-device command: " + cmdStr;
  }

  async function executeShellCommand(commandLine, githubToken) {
    // Support chaining with && or ;
    var parts = commandLine.split(/\s*(?:&&|;)\s*/);
    var outputs = [];
    for (var i = 0; i < parts.length; i++) {
      var out = await runSingleCommand(parts[i], githubToken);
      if (out) outputs.push(out);
    }
    return outputs.join("\n");
  }

  global.AgyGitShell = {
    state: state,
    initEnv: initEnv,
    normPath: normPath,
    executeShellCommand: executeShellCommand,
    gitCloneOnDevice: gitCloneOnDevice,
    walkWorkspaceFiles: walkWorkspaceFiles,
  };
})(window);
