<div align="center">

  <h1>⚡ Antigravity for iOS</h1>
  <p><b>Standalone Autonomous AI Coding Environment for iOS & iPadOS (.ipa)</b></p>

  [![iOS](https://img.shields.io/badge/iOS-15.0%2B-000000?style=flat-square&logo=apple&logoColor=white)](https://apple.com/ios)
  [![Arch](https://img.shields.io/badge/ARM64-Apple_Silicon-blue?style=flat-square)](https://developer.apple.com)
  [![Download IPA](https://img.shields.io/badge/Download-antigravity--ios.ipa-0284c7?style=flat-square&logo=apple&logoColor=white)](https://github.com/tuanlee-tech/antigravity-ios/releases/latest/download/antigravity-ios.ipa)
  [![Releases](https://img.shields.io/github/v/release/tuanlee-tech/antigravity-ios?style=flat-square&color=blueviolet)](https://github.com/tuanlee-tech/antigravity-ios/releases/latest)
  [![License](https://img.shields.io/badge/License-Apache_2.0-orange?style=flat-square)](LICENSE)

  <br/>

  ### ⬇️ [Tải trực tiếp `antigravity-ios.ipa` (Bản mới nhất)](https://github.com/tuanlee-tech/antigravity-ios/releases/latest/download/antigravity-ios.ipa)
  *(Hoặc xem tất cả các bản phát hành tại [GitHub Releases](https://github.com/tuanlee-tech/antigravity-ios/releases/latest))*

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

### 📲 Hướng dẫn Cài đặt `antigravity-ios.ipa` lên iPhone / iPad (Không cần App Store, không cần Jailbreak)

#### Bước 0: Tải file `.ipa`
Tải file mới nhất tại đây: [**`antigravity-ios.ipa`**](https://github.com/tuanlee-tech/antigravity-ios/releases/latest/download/antigravity-ios.ipa)

Chọn **1 trong 3 cách** dưới đây tùy thiết bị của bạn:

#### Cách 1: Dùng Sideloadly (Dễ nhất — Windows & macOS, Miễn phí)
1. Tải và cài đặt [**Sideloadly**](https://sideloadly.io/) trên máy tính (Windows cần cài thêm iTunes & iCloud bản tải từ web Apple, không phải bản Microsoft Store).
2. Cắm cáp nối iPhone/iPad với máy tính và bấm **Tin cậy (Trust)** trên màn hình iPhone.
3. Mở Sideloadly ➔ kéo thả file **`antigravity-ios.ipa`** vào biểu tượng IPA ➔ nhập tài khoản Apple ID của bạn ➔ bấm **Start**.
4. Sau khi báo **Done**, trên iPhone làm thêm 2 thao tác mở khóa của Apple:
   - Vào **Cài đặt (Settings) ➔ Cài đặt chung (General) ➔ Quản lý VPN & Thiết bị (VPN & Device Management)** ➔ bấm vào email Apple ID của bạn ➔ chọn **Tin cậy (Trust)**.
   - *(Với iOS 16 trở lên)*: Vào **Cài đặt ➔ Quyền riêng tư & Bảo mật (Privacy & Security) ➔ Chế độ nhà phát triển (Developer Mode)** ➔ Bật lên và khởi động lại máy.
   - *(Lưu ý: Apple ID miễn phí cần cắm Sideloadly ký lại sau mỗi 7 ngày, hoặc bật **Wi-Fi Refresh** trong Sideloadly để tự động gia hạn qua Wi-Fi).*

#### Cách 2: Dùng SideStore / AltStore (Tự gia hạn ngay trên iPhone, không cần cắm máy tính)
1. Nếu iPhone của bạn đã cài sẵn [**SideStore**](https://sidestore.io/) hoặc [**AltStore**](https://altstore.io/):
2. Mở Safari trên iPhone, tải trực tiếp [**`antigravity-ios.ipa`**](https://github.com/tuanlee-tech/antigravity-ios/releases/latest/download/antigravity-ios.ipa).
3. Mở app **SideStore / AltStore** ➔ tab **My Apps** ➔ bấm dấu **`+`** ở góc trên ➔ chọn file `antigravity-ios.ipa` vừa tải là xong.

#### Cách 3: Cài vĩnh viễn (Không giới hạn 7 ngày)
- **TrollStore (iOS 14.0 – 17.0):** Tải `antigravity-ios.ipa` bằng Safari trên iPhone ➔ bấm **Chia sẻ (Share) ➔ TrollStore** ➔ **Install**.
- **ESign / Scarlet / Chứng chỉ P12:** Nhập file `antigravity-ios.ipa` vào ESign ➔ ký bằng chứng chỉ cá nhân ➔ cài đặt trực tiếp trên iPhone.

---

### 🚀 Bắt đầu Vibecode trên iPhone trong 3 bước

1. **Đăng nhập Google:** Mở app **Antigravity** ➔ bấm **Sign in** (góc phải trên) ➔ **🌐 Sign in with Google**. App tự động nhận diện gói tài khoản (Free / Pro / Ultra) và nạp đúng danh sách Model khả dụng của bạn.
2. **Clone repo ngay trong khung chat:** Nhắn trực tiếp vào khung chat:
   > *"Chạy lệnh `git clone https://github.com/<user>/<repo>.git`"*
   *(Nếu là repo Private hoặc cần `git push`, thêm GitHub Personal Access Token trong mục Account ở góc phải trên).*
3. **Mở thư mục & Vibecode với `/grill-me`:**
   - Bấm **📂 Open Folder** ở góc trái trên ➔ chọn thư mục `<repo>` vừa clone (hoặc bấm **`+ New Folder`** / **Mở từ ứng dụng Tệp iOS**).
   - Bấm nút nhanh **🔥 `/grill-me`** và dùng phím **Micro trên bàn phím iPhone** để đọc ý tưởng, chọn phương án bằng 1 ngón tay và xem diff trực tiếp!

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
