import UIKit
import WebKit
import SafariServices
import UniformTypeIdentifiers

final class MainViewController: UIViewController, WKScriptMessageHandler, UIDocumentPickerDelegate, SFSafariViewControllerDelegate {
    private var webView: WKWebView!
    private let fsBridge = NativeFileSystemBridge()
    private let oauthServer = OAuthLoopbackServer()
    private var safariVC: SFSafariViewController?
    private var pendingOAuthCallbackId: String?
    private var pendingFolderCallbackId: String?

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.04, green: 0.05, blue: 0.09, alpha: 1.0)

        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(self, name: "agyNative")
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(webView)

        loadLocalWebUI()
    }

    private func loadLocalWebUI() {
        if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")
            ?? Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(indexUrl, allowingReadAccessTo: indexUrl.deletingLastPathComponent())
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "agyNative",
              let body = message.body as? [String: Any],
              let callbackId = body["callbackId"] as? String,
              let action = body["action"] as? String else {
            return
        }
        let payload = (body["payload"] as? [String: Any]) ?? [:]

        if action == "startGoogleOAuth" {
            let cid = payload["clientId"] as? String
            let csec = payload["clientSecret"] as? String
            startGoogleOAuth(callbackId: callbackId, clientId: cid, clientSecret: csec)
            return
        }

        if action == "pickExternalFolder" {
            pendingFolderCallbackId = callbackId
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            present(picker, animated: true)
            return
        }

        fsBridge.handleAction(action, payload: payload) { [weak self] response in
            self?.sendCallback(callbackId: callbackId, response: response)
        }
    }

    private func startGoogleOAuth(callbackId: String, clientId: String? = nil, clientSecret: String? = nil) {
        pendingOAuthCallbackId = callbackId
        oauthServer.start(clientId: clientId, clientSecret: clientSecret, completion: { [weak self] res in
            DispatchQueue.main.async {
                switch res {
                case .success(let authUrl):
                    let svc = SFSafariViewController(url: authUrl)
                    svc.delegate = self
                    svc.modalPresentationStyle = .pageSheet
                    self?.safariVC = svc
                    self?.present(svc, animated: true)
                case .failure(let err):
                    self?.pendingOAuthCallbackId = nil
                    self?.sendCallback(callbackId: callbackId, response: ["ok": false, "error": err.localizedDescription])
                }
            }
        }, onToken: { [weak self] tokenRes in
            DispatchQueue.main.async {
                let cb = self?.pendingOAuthCallbackId
                self?.pendingOAuthCallbackId = nil
                self?.safariVC?.dismiss(animated: true)
                self?.safariVC = nil
                guard let cbId = cb else { return }
                switch tokenRes {
                case .success(let tokenJson):
                    self?.sendCallback(callbackId: cbId, response: ["ok": true, "token": tokenJson])
                case .failure(let err):
                    self?.sendCallback(callbackId: cbId, response: ["ok": false, "error": err.localizedDescription])
                }
            }
        })
    }

    func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        if let cbId = pendingOAuthCallbackId {
            pendingOAuthCallbackId = nil
            oauthServer.stop()
            safariVC = nil
            sendCallback(callbackId: cbId, response: ["ok": false, "error": "Người dùng đã hủy đăng nhập Google."])
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let cbId = pendingFolderCallbackId else { return }
        pendingFolderCallbackId = nil
        guard let folderUrl = urls.first else {
            sendCallback(callbackId: cbId, response: ["ok": false, "cancelled": true])
            return
        }
        let path = fsBridge.registerSecurityScopedFolder(folderUrl)
        sendCallback(callbackId: cbId, response: ["ok": true, "path": path, "name": folderUrl.lastPathComponent])
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let cbId = pendingFolderCallbackId else { return }
        pendingFolderCallbackId = nil
        sendCallback(callbackId: cbId, response: ["ok": false, "cancelled": true])
    }

    private func sendCallback(callbackId: String, response: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: response),
              let jsonStr = String(data: jsonData, encoding: .utf8) else {
            return
        }
        DispatchQueue.main.async { [weak self] in
            let js = "window.__onAgyNativeCallback && window.__onAgyNativeCallback(\(jsonStr), '\(callbackId)');"
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
