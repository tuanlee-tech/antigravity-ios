<div align="center">

  <h1>⚡ Antigravity for iOS</h1>
  <p><b>Standalone Autonomous AI Coding Environment for iOS & iPadOS (.ipa)</b></p>

  [![iOS](https://img.shields.io/badge/iOS-15.0%2B-000000?style=flat-square&logo=apple&logoColor=white)](https://apple.com/ios)
  [![Arch](https://img.shields.io/badge/ARM64-Apple_Silicon-blue?style=flat-square)](https://developer.apple.com)
  [![License](https://img.shields.io/badge/License-Apache_2.0-orange?style=flat-square)](LICENSE)

</div>

---

### Overview

**Antigravity for iOS** (`antigravity-ios.ipa`) là phiên bản dành cho iPhone & iPad tương ứng với [`antigravity-android`](https://github.com/werdio325-png/antigravity-android), cho phép **bất kỳ người dùng iOS nào** cài đặt file `.ipa` lên máy (qua *Sideloadly*, *AltStore*, *SideStore*, *TrollStore*, *ESign* — không cần kiểm duyệt App Store) và sử dụng trực tiếp tài khoản Google Antigravity của riêng họ.

1. **Đăng nhập Google OAuth chính chủ của Antigravity (`daily-cloudcode-pa.googleapis.com`):**
   - Sử dụng máy chủ OAuth Loopback nội bộ (`OAuthLoopbackServer.swift` trên `127.0.0.1`) ngay trên iPhone để đăng nhập tài khoản Google của người dùng.
   - Tự động gọi `/v1internal:loadCodeAssist` và `/v1internal:fetchAvailableModels` để nhận diện gói tài khoản (**Free Tier / Pro / Ultra**) và nạp đúng danh sách các Model mà tài khoản đó được phép chọn.
2. **Nhắn Chat bảo Agent `git clone` repo trực tiếp về iPhone:**
   - Tích hợp sẵn bộ thực thi **On-Device Git & POSIX Shell (`ondevice_git_shell.js` + `NativeFileSystemBridge.swift`)** chạy trực tiếp trên ổ cứng iPhone mà không vi phạm giới hạn `fork()` của nhân iOS XNU.
   - Người dùng chỉ cần nhắn vào khung chat:
     > *"Chạy lệnh `git clone https://github.com/<user>/<repo>.git` về máy giúp tôi"*
   - Agent sẽ tự động gọi tool `run_command` và clone toàn bộ repo vào thư mục `~/Documents/projects/<repo>` trên iPhone (hiển thị trực tiếp trong ứng dụng **Tệp / Files** của iOS tại mục **Trên iPhone của tôi ➔ Antigravity**).
3. **Chọn Folder (`📂 Open Folder` / `+ New Folder`) & Vibecode với `/grill-me`:**
   - Bấm nút **📂 Open Folder** ở góc trái trên màn hình để tạo thư mục mới (`+ New Folder`), chọn thư mục repo vừa được Agent clone về, hoặc mở bất kỳ thư mục nào từ ứng dụng *Tệp (iOS Files App)* qua `UIDocumentPickerViewController`.
   - Giao diện tối giản 1 ngón cái chuyên biệt cho `/grill-me` (hiển thị thẻ trắc nghiệm bấm 1 chạm ngay trong khung chat), xem file diff trực quan và đọc lệnh bằng giọng nói tiếng Việt.

---

### Cấu trúc Dự án

```text
antigravity-ios/
├── .github/workflows/
│   └── build-and-release-ipa.yml   # GitHub Actions (macos-latest + Xcode) tự động build file antigravity-ios.ipa
├── ios/                            # Native iOS App (Swift + WKWebView + Security-Scoped FileSystem)
│   ├── project.yml                 # Cấu hình XcodeGen
│   └── AntigravityIOS/
│       ├── Info.plist              # Bật UIFileSharingEnabled & LSSupportsOpeningDocumentsInPlace
│       ├── AppDelegate.swift       # Quản lý vòng đời & giữ Background Task khi khóa màn hình iPhone
│       ├── MainViewController.swift# WKWebView host + SFSafariViewController + UIDocumentPickerViewController
│       ├── OAuthLoopbackServer.swift # Máy chủ 127.0.0.1 bắt callback Google OAuth tự động trên iPhone
│       └── NativeFileSystemBridge.swift # Cầu nối đọc/ghi file trực tiếp trên iPhone & CORS-free HTTP Proxy
├── web/                            # Giao diện Minimalist UI & On-Device Agent Runtime
│   ├── index.html                  # Giao diện cảm ứng 1 tay cho iOS
│   ├── styles.css                  # Thiết kế Dark Mode hỗ trợ Safe Area / Dynamic Island
│   ├── cloudcode_client.js         # Kết nối trực tiếp daily-cloudcode-pa.googleapis.com (OAuth, Tier, Models, Stream)
│   ├── ondevice_git_shell.js       # Thực thi git clone/status/diff & POSIX shell (ls, cd, mkdir, cat, rm) trên iPhone
│   └── app.js                      # Vòng lặp Agent (run_command, read_file, write_file, edit_file, ask_question /grill-me)
└── dev_preview_server.py           # Simulator chạy thử toàn bộ tính năng trên máy tính trước khi build .ipa
```

---

### Cách Build file `antigravity-ios.ipa` miễn phí bằng GitHub Actions (Không cần có máy Mac)

1. Ngay khi push code lên nhánh `main` (hoặc bấm **Run workflow** trong tab [**Actions**](https://github.com/tuanlee-tech/antigravity-ios/actions) trên GitHub), máy ảo `macos-latest` của GitHub sẽ tự động chạy `xcodegen` + `xcodebuild` + `ldid` để đóng gói ra file **`antigravity-ios.ipa`** trong phần **Artifacts / Releases**.
2. Tải `antigravity-ios.ipa` về và cài lên iPhone/iPad qua **Sideloadly**, **AltStore**, **SideStore**, hoặc **TrollStore**.

---

### Chạy thử ngay trên máy Linux / Desktop (Simulator)

Bạn có thể test thử ngay giao diện iOS, đăng nhập Google OAuth, chọn Model theo Tier và nhắn Agent chạy `git clone` ngay trên máy tính bằng lệnh:

```bash
python3 dev_preview_server.py
```
Sau đó mở trình duyệt vào `http://127.0.0.1:8765`.
