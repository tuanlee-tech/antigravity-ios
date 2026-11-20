import Foundation
import Network

/// Runs a temporary loopback HTTP server on 127.0.0.1:<port> on the iPhone
/// to intercept the Google OAuth 2.0 redirect (`http://localhost:<port>/oauth-callback?code=...`)
/// and exchange the code for an Antigravity Cloud Code OAuth token.
final class OAuthLoopbackServer {
    static var defaultClientId: String {
        (Bundle.main.object(forInfoDictionaryKey: "AGYOAuthClientId") as? String) ?? ""
    }
    static var defaultClientSecret: String {
        (Bundle.main.object(forInfoDictionaryKey: "AGYOAuthClientSecret") as? String) ?? ""
    }
    static let scopes = [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/cclog",
        "https://www.googleapis.com/auth/experimentsandconfigs"
    ].joined(separator: " ")

    private var listener: NWListener?
    private var port: UInt16 = 0
    private var activeClientId: String = ""
    private var activeClientSecret: String = ""
    private var onTokenResult: ((Result<[String: Any], Error>) -> Void)?

    func start(clientId: String? = nil,
               clientSecret: String? = nil,
               completion: @escaping (Result<URL, Error>) -> Void,
               onToken: @escaping (Result<[String: Any], Error>) -> Void) {
        stop()
        self.activeClientId = (clientId?.isEmpty == false ? clientId! : Self.defaultClientId)
        self.activeClientSecret = (clientSecret?.isEmpty == false ? clientSecret! : Self.defaultClientSecret)
        self.onTokenResult = onToken

        guard !self.activeClientId.isEmpty else {
            completion(.failure(NSError(
                domain: "OAuth",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Chưa cấu hình OAuth Client ID (cài trong Account Settings hoặc GitHub Actions Secrets khi build .ipa)."]
            )))
            return
        }

        do {
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
            let nwListener = try NWListener(using: params)
            self.listener = nwListener

            nwListener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                case .ready:
                    if let assignedPort = nwListener.port?.rawValue {
                        self.port = assignedPort
                        let redirectUri = "http://localhost:\(assignedPort)/oauth-callback"
                        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
                        comps.queryItems = [
                            URLQueryItem(name: "client_id", value: self.activeClientId),
                            URLQueryItem(name: "redirect_uri", value: redirectUri),
                            URLQueryItem(name: "response_type", value: "code"),
                            URLQueryItem(name: "scope", value: Self.scopes),
                            URLQueryItem(name: "access_type", value: "offline"),
                            URLQueryItem(name: "prompt", value: "consent")
                        ]
                        if let authUrl = comps.url {
                            completion(.success(authUrl))
                        }
                    }
                case .failed(let err):
                    completion(.failure(err))
                default:
                    break
                }
            }

            nwListener.newConnectionHandler = { [weak self] conn in
                self?.handleConnection(conn)
            }

            nwListener.start(queue: .global(qos: .userInitiated))
        } catch {
            completion(.failure(error))
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleConnection(_ conn: NWConnection) {
        conn.start(queue: .global(qos: .userInitiated))
        conn.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, _, _ in
            guard let self = self,
                  let data = data,
                  let reqStr = String(data: data, encoding: .utf8) else {
                conn.cancel()
                return
            }

            let firstLine = reqStr.components(separatedBy: "\r\n").first ?? ""
            let parts = firstLine.components(separatedBy: " ")
            let pathAndQuery = parts.count > 1 ? parts[1] : "/"

            guard let urlComps = URLComponents(string: "http://localhost\(pathAndQuery)") else {
                conn.cancel()
                return
            }

            let code = urlComps.queryItems?.first(where: { $0.name == "code" })?.value
            let html = """
            HTTP/1.1 200 OK\r
            Content-Type: text/html; charset=utf-8\r
            Connection: close\r
            \r
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{background:#0b0e17;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;text-align:center;}</style></head>
            <body><div><h2>⚡ Đăng nhập Antigravity thành công!</h2><p>Đang quay lại ứng dụng...</p></div></body></html>
            """
            conn.send(content: html.data(using: .utf8), completion: .contentProcessed { _ in
                conn.cancel()
            })

            if let authCode = code {
                let redirectUri = "http://localhost:\(self.port)/oauth-callback"
                self.stop()
                self.exchangeCodeForToken(code: authCode, redirectUri: redirectUri)
            }
        }
    }

    private func exchangeCodeForToken(code: String, redirectUri: String) {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        var comps = URLComponents()
        var items = [
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: self.activeClientId),
            URLQueryItem(name: "redirect_uri", value: redirectUri),
            URLQueryItem(name: "grant_type", value: "authorization_code")
        ]
        if !self.activeClientSecret.isEmpty {
            items.append(URLQueryItem(name: "client_secret", value: self.activeClientSecret))
        }
        comps.queryItems = items
        req.httpBody = comps.percentEncodedQuery?.data(using: .utf8)

        URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
            if let err = err {
                self?.onTokenResult?(.failure(err))
                return
            }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                self?.onTokenResult?(.failure(NSError(domain: "OAuth", code: -1)))
                return
            }
            self?.onTokenResult?(.success(json))
        }.resume()
    }
}
