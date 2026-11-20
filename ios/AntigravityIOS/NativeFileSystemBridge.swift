import Foundation

/// Native iOS FileSystem & CORS-Free HTTP Bridge exposed to the WebView.
/// Gives the on-device Agent and isomorphic-git full in-place read/write access
/// to `Documents/` (visible in iOS Files app under "On My iPhone -> Antigravity")
/// as well as any external folder selected via `UIDocumentPickerViewController`.
final class NativeFileSystemBridge {
    private var securityScopedRoots: [String: URL] = [:]

    var documentsURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let projects = docs.appendingPathComponent("projects", isDirectory: true)
        if !FileManager.default.fileExists(atPath: projects.path) {
            try? FileManager.default.createDirectory(at: projects, withIntermediateDirectories: true)
        }
        return docs
    }

    func registerSecurityScopedFolder(_ url: URL) -> String {
        _ = url.startAccessingSecurityScopedResource()
        let mountPath = "/ external/\(url.lastPathComponent)".replacingOccurrences(of: "/ ", with: "/")
        securityScopedRoots[mountPath] = url
        if let bookmark = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(bookmark, forKey: "agy_last_folder_bookmark")
        }
        return url.path
    }

    func resolvePath(_ rawPath: String) -> URL {
        let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "~" || trimmed == "~/Documents" {
            return documentsURL
        }
        if trimmed.hasPrefix("~/") {
            let rel = String(trimmed.dropFirst(2))
            return documentsURL.appendingPathComponent(rel)
        }
        if trimmed.hasPrefix("/var/") || trimmed.hasPrefix("/private/var/") {
            return URL(fileURLWithPath: trimmed)
        }
        if trimmed.hasPrefix("/") {
            let rel = String(trimmed.dropFirst(1))
            return documentsURL.appendingPathComponent(rel)
        }
        return documentsURL.appendingPathComponent(trimmed)
    }

    func handleAction(_ action: String, payload: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        let fm = FileManager.default
        switch action {
        case "getEnv":
            completion([
                "ok": true,
                "documentsPath": documentsURL.path,
                "projectsPath": documentsURL.appendingPathComponent("projects").path,
                "platform": "ios-native",
                "oauthClientId": (Bundle.main.object(forInfoDictionaryKey: "AGYOAuthClientId") as? String) ?? "",
                "oauthClientSecret": (Bundle.main.object(forInfoDictionaryKey: "AGYOAuthClientSecret") as? String) ?? ""
            ])

        case "listDir":
            let path = (payload["path"] as? String) ?? documentsURL.path
            let url = resolvePath(path)
            do {
                let items = try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey], options: [])
                var entries: [[String: Any]] = []
                for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                    let vals = try? item.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
                    entries.append([
                        "name": item.lastPathComponent,
                        "path": item.path,
                        "isDir": vals?.isDirectory ?? false,
                        "size": vals?.fileSize ?? 0
                    ])
                }
                completion(["ok": true, "path": url.path, "entries": entries])
            } catch {
                completion(["ok": false, "error": error.localizedDescription])
            }

        case "mkdir":
            let path = (payload["path"] as? String) ?? ""
            let url = resolvePath(path)
            do {
                try fm.createDirectory(at: url, withIntermediateDirectories: true)
                completion(["ok": true, "path": url.path])
            } catch {
                completion(["ok": false, "error": error.localizedDescription])
            }

        case "readFile":
            let path = (payload["path"] as? String) ?? ""
            let encoding = (payload["encoding"] as? String) ?? "utf8"
            let url = resolvePath(path)
            do {
                let data = try Data(contentsOf: url)
                if encoding == "base64" {
                    completion(["ok": true, "data": data.base64EncodedString(), "size": data.count])
                } else {
                    let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
                    completion(["ok": true, "content": text, "size": data.count])
                }
            } catch {
                completion(["ok": false, "error": error.localizedDescription])
            }

        case "writeFile":
            let path = (payload["path"] as? String) ?? ""
            let url = resolvePath(path)
            do {
                try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                if let b64 = payload["base64"] as? String, let data = Data(base64Encoded: b64) {
                    try data.write(to: url, options: .atomic)
                } else if let content = payload["content"] as? String {
                    try content.data(using: .utf8)?.write(to: url, options: .atomic)
                }
                completion(["ok": true, "path": url.path])
            } catch {
                completion(["ok": false, "error": error.localizedDescription])
            }

        case "deletePath":
            let path = (payload["path"] as? String) ?? ""
            let url = resolvePath(path)
            do {
                if fm.fileExists(atPath: url.path) {
                    try fm.removeItem(at: url)
                }
                completion(["ok": true])
            } catch {
                completion(["ok": false, "error": error.localizedDescription])
            }

        case "stat":
            let path = (payload["path"] as? String) ?? ""
            let url = resolvePath(path)
            var isDir: ObjCBool = false
            let exists = fm.fileExists(atPath: url.path, isDirectory: &isDir)
            let attrs = try? fm.attributesOfItem(atPath: url.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            completion([
                "ok": true,
                "exists": exists,
                "isDir": isDir.boolValue,
                "size": size,
                "path": url.path
            ])

        case "httpProxy":
            // CORS-free native URLSession request for Cloud Code API & Git Smart HTTP
            guard let urlStr = payload["url"] as? String, let reqUrl = URL(string: urlStr) else {
                completion(["ok": false, "error": "Invalid URL"])
                return
            }
            var req = URLRequest(url: reqUrl)
            req.httpMethod = (payload["method"] as? String) ?? "GET"
            if let headers = payload["headers"] as? [String: String] {
                for (k, v) in headers {
                    req.setValue(v, forHTTPHeaderField: k)
                }
            }
            if let bodyB64 = payload["bodyBase64"] as? String, let bodyData = Data(base64Encoded: bodyB64) {
                req.httpBody = bodyData
            } else if let bodyStr = payload["body"] as? String {
                req.httpBody = bodyStr.data(using: .utf8)
            }

            URLSession.shared.dataTask(with: req) { data, resp, err in
                if let err = err {
                    completion(["ok": false, "error": err.localizedDescription])
                    return
                }
                let httpResp = resp as? HTTPURLResponse
                let status = httpResp?.statusCode ?? 200
                var respHeaders: [String: String] = [:]
                httpResp?.allHeaderFields.forEach { k, v in
                    respHeaders[String(describing: k).lowercased()] = String(describing: v)
                }
                let respData = data ?? Data()
                let isBinary = (payload["responseType"] as? String) == "base64"
                if isBinary {
                    completion([
                        "ok": true,
                        "status": status,
                        "headers": respHeaders,
                        "bodyBase64": respData.base64EncodedString()
                    ])
                } else {
                    completion([
                        "ok": true,
                        "status": status,
                        "headers": respHeaders,
                        "body": String(decoding: respData, as: UTF8.self)
                    ])
                }
            }.resume()

        default:
            completion(["ok": false, "error": "Unknown action: \(action)"])
        }
    }
}
