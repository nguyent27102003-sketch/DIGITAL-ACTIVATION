# 📘 TÀI LIỆU ĐẶC TẢ VÀ KẾ HOẠCH NÂNG CẤP HỆ THỐNG "ĐỌC HÌNH ACTIVATION"
> **Dành cho:** Kỹ sư phát triển / Assistant AI (Antigravity) đọc và triển khai trực tiếp.
> **Ngày cập nhật:** 21/07/2026

---

## 1. TỔNG QUAN DỰ ÁN & MÃ NGUỒN HIỆN TẠI (DEV BASELINE V1.0)

Dự án **ĐỌC HÌNH ACTIVATION (FBEval Bot)** là ứng dụng Web chạy cục bộ (Node.js Express + React Vite) giúp đánh giá tự động các bài viết/video clip/livestream truyền thông Facebook/Tiktok cho các chương trình Trade Activation / Branding của nhãn hàng Nutricare / Hùng Cường Company.

### 📁 Cấu trúc thư mục hiện tại:
```
ĐỌC HÌNH ACTIVATION/
├── src/                      # Backend (Express ESM)
│   ├── server.js             # Express API Server, Job State, Processing Queue
│   ├── scraper.js            # Playwright Headless Browser & Cookie Session Manager
│   ├── analyzer.js           # Gemini 1.5 Flash / 9Router Multimodal AI Vision Processor
│   └── excelProcessor.js     # Reader / Exporter Excel (XLSX / ExcelJS)
├── frontend/                 # Frontend (React + Vite)
│   ├── src/
│   │   ├── App.jsx           # UI điều khiển chính
│   │   ├── App.css           # Styling giao diện
│   │   └── main.jsx
├── data/
│   ├── user_profile/         # Lưu session Chrome persistent
│   ├── cookies.json          # Lưu cookies trích xuất để inject browser context
│   ├── uploads/              # File Excel tạm tải lên
│   └── history/              # Lưu lịch sử các lần chạy (Job JSON)
└── public/
    ├── screenshots/          # Lưu ảnh chụp màn hình bài viết
    └── exports/              # Lưu file Excel kết quả xuất ra
```

### ⚙️ Các API Backend hiện có (`src/server.js`):
1. `GET /api/config-status`: Kiểm tra trạng thái API Key & kết nối Facebook Session.
2. `POST /api/login-browser`: Mở trình duyệt Chrome cho người dùng đăng nhập Facebook 1 lần để lưu cookie.
3. `POST /api/upload-excel`: Tải file Excel danh sách link bài viết và trích xuất URL.
4. `POST /api/start-evaluation`: Bắt đầu tiến trình quét và đánh giá link bài nộp theo hàng đợi song song (Concurrency).
5. `GET /api/job-status`: Lấy trạng thái tiến trình chạy thực tế.
6. `POST /api/cancel-job`: Hủy tiến trình đang chạy.
7. `GET /api/history` & `GET /api/history/:id`: Quản lý lịch sử các lượt chấm.
8. `POST /api/export-results`: Xuất kết quả đánh giá ra file Excel.

---

## 2. PHÂN TÍCH YÊU CẦU NGHỆP VỤ THỰC TẾ (REAL-WORLD REQUIREMENTS)

Dựa trên việc đọc và phân tích 2 file Excel dữ liệu thực tế của bên nhãn hàng:
1. File 1: `FINAL Chương Trình Livestream, video clip- Sữa trái cây Smarta Grow Opti Tháng 6.xlsx`
2. File 2: `26.06. FINAL Tracking Chương Trình Livestream, video clip- Metacare Opti C- Section.xlsx`

### 📥 A. Ranh giới Dữ Liệu Đầu Vào (Input Data - Do người dùng/PM điền):
* Thông tin quản lý: STT, KHU VỰC, Mã KH, Tên KH, Mã NPP, Tên NPP, PG Sup, PM.
* **Link thông tin bài viết:**
  * `LINK Fanpage/ Facebook/ tiktok` (Kênh đăng bài).
  * **`LINK Livestream/ video clip được gửi về`** (Đây là LINK BẮT BUỘC BOT PHẢI TRUY CẬP VÀ ĐÁNH GIÁ).
* Thông tin khai báo: `Ngày gửi link`, `Ngày thực hiện`, `Giờ thực hiện`, `Tổng giờ livestream/video clip` (shop khai báo).

### 📤 B. Ranh giới Dữ Liệu Đầu Ra (Output Data - BOT PHẢI TỰ ĐỘNG CHẤM VÀ ĐIỀN):
* **`ĐK1: Thời gian livestream >=15p / Video clip >=30s`**: Trả về **`Đạt`** hoặc **`Không đạt`** (Dựa vào thời lượng video/livestream thực tế Bot quét được).
* **`ĐK2: Nội dung Caption, gắn thẻ Fanpage, Hashtag`**: Trả về **`Đạt`** hoặc **`Không đạt`** (Bot dùng AI soi Caption + Ảnh bài viết: Đủ bộ Hashtag bắt buộc, Tag đúng Fanpage `@HùngCườngCompany`, đúng tên sản phẩm, có Lời kêu gọi hành động CTA).
* **`Hình đối chiếu Tracking` / `Hình đối chiếu 1` & `2`**: Bot lưu ảnh chụp màn hình bằng chứng bài viết và chèn link ảnh vào ô này.
  * *Sheet Top 200:* 1 Link ảnh chứng cứ (`Hình đối chiếu Tracking`).
  * *Sheet Top 3:* 2 Link ảnh chứng cứ (`Hình đối chiếu 1`: Chụp Caption/Hashtag/Thời lượng; `Hình đối chiếu 2`: Chụp Chỉ số tương tác/Views).
* **`Ghi chú KQ tracking`**: Bot tự động điền câu nhận xét lý do vi phạm *(VD: "Thiếu hashtag #10tyloikhuan", "Video chỉ dài 20s không đủ 30s")*.
* **`Phân Loại`**: Bot tự điền **`Livestream`** hoặc **`Video clip`**.
* **`Kết Quả`**: Trả về **`Đạt`** (Nếu cả ĐK1 = Đạt VÀ ĐK2 = Đạt) hoặc **`Không đạt`**.
* **`Chỉ số tương tác thực tế`**: Bot đọc và điền 4 số: `Like/tim`, `Share`, `Comment`, `View` (Mắt xem).
* **`TỔNG ĐIỂM ĐUA TOP`**: Tính tổng `= Like + Share + Comment + View`.
* **`Bảng Thống Kê Tổng Hợp`**: Tự động tính toán lại % Đạt và % Thực hiện theo từng Miền ở phần đầu trang Excel.

### 🔄 C. Yêu cầu Tính Linh Hoạt Đa Chương Trình (Universal Engine):
* Bot phải xử lý được **BẤT KỲ chương trình nào**, không được ghi mã cứng (hardcode) cho riêng 1 tháng.
* **Hỗ trợ 2 Chế Độ File Excel:**
  1. *Chế độ 1 Bài / 1 Dòng* (VD: Sheet Top 200).
  2. *Chế độ Nhiều Phiên (Multi-session) / 1 Dòng* (VD: Sheet Metacare Opti có Phiên 1, Phiên 2,... Phiên 8).
* **Hỗ trợ Đọc Rule từ Poster:** Người dùng có thể tải ảnh Poster thể lệ của tháng đó lên, AI sẽ tự bóc tách ra danh sách Hashtag, Tag Page và Tiêu chí thời lượng.

---

## 3. CHUYÊN MỤC KẾ HOẠCH NÂNG CẤP CHI TIẾT (UPGRADE SPECIFICATIONS)

Cần thực hiện nâng cấp trực tiếp vào 5 mô-đun mã nguồn chính:

### 🛠️ Nâng cấp 1: Bộ Máy Phân Tích AI Multimodal (`src/analyzer.js`)

1. **Bổ sung Hàm Tự Động Trích Xuất Rule Từ Ảnh Poster (`extractRulesFromPoster`)**:
   * Input: Ảnh chụp Poster thể lệ chương trình.
   * Output JSON:
     ```json
     {
       "campaignName": "String",
       "requiredHashtags": ["#10tyloikhuan", "#caovuottroi", "#giainhietmuahe", "#SmartaGrowOpti"],
       "requiredTags": ["@HùngCườngCompany"],
       "minVideoDurationSec": 30,
       "minLivestreamDurationMin": 15,
       "requireCTA": true,
       "keywords": ["Sữa trái cây Smarta Grow Opti"]
     }
     ```

2. **Cập nhật Prompt Chấm Bài (`analyzePost`)**:
   * Định dạng Output JSON trả về chuẩn hóa cho hệ thống:
     ```json
     {
       "postType": "Livestream" | "Video clip",
       "durationSeconds": number | null,
       "dk1": {
         "isStandard": boolean,
         "reason": "Giải thích chi tiết thời lượng"
       },
       "dk2": {
         "isStandard": boolean,
         "missingHashtags": [],
         "missingTags": [],
         "hasCTA": boolean,
         "reason": "Giải thích chi tiết caption/hashtag/tag page"
       },
       "likes": number | null,
       "comments": number | null,
       "shares": number | null,
       "views": number | null,
       "isPassed": boolean,
       "overallFeedback": "Ghi chú ngắn gọn kết quả tracking"
     }
     ```

---

### 🌐 Nâng cấp 2: Trình Quét Trình Duyệt Bằng Chứng (`src/scraper.js`)

1. **Bóc Tách Mắt Xem (Views) & Thời Lượng Video**:
   * Tìm và trích xuất thời lượng hiển thị trên video player Facebook/Tiktok (Ví dụ: `0:49`, `16:46`, `1:10:50`).
   * Trích xuất lượt xem `Views` / `Mắt xem` (Ví dụ: `221K lượt xem`, `1.5K lượt xem` $\rightarrow$ Đổi về số nguyên `221000`, `1500`).

2. **Chụp 2 Ảnh Màn Hình Chứng Cứ (`proofScreen1`, `proofScreen2`)**:
   * `proofScreen1`: Chụp khu vực Caption, tiêu đề, thời lượng video và thông tin bài viết.
   * `proofScreen2`: Chụp khu vực thanh tương tác hiển thị Like, Share, Comment, Views.
   * Lưu ảnh vào `public/screenshots/` và trả về URL ảnh tĩnh tương ứng.

---

### 📊 Nâng cấp 3: Bộ Xử Lý File Excel Động (`src/excelProcessor.js`)

1. **Nhận Diện Cột Thông Minh (Fuzzy Header Search)**:
   * Tìm hàng tiêu đề (Header Row) dựa trên các từ khóa: `Mã KH`, `Tên KH`, `LINK`, `ĐK1`, `ĐK2`, `Kết Quả`, `Like`, `Share`, `Comment`, `View`...
   * Nhận diện xem file thuộc dạng **Bảng Đơn** hay **Bảng Nhiều Phiên (Phiên 1, Phiên 2...)**.

2. **Ghi Kết Quả Giữ Nguyên Định Dạng Template (Preserve Formatting & Formulas)**:
   * Sử dụng thư viện `exceljs` để mở trực tiếp file mẫu Excel do người dùng cung cấp.
   * Ghi các giá trị kết quả do Bot tính toán vào đúng ô (Cell) tương ứng của từng dòng.
   * **Tự động cập nhật Bảng Thống Kê Miền (Summary Table)** ở dòng 1-7 của Sheet bằng cách tính lại các ô tổng cộng `SL Shop Tham Gia`, `Đã thực hiện`, `Thực hiện đạt`, `Tỷ lệ %`.

---

### 🖥️ Nâng cấp 4: Giao Diện Người Dùng Frontend (`frontend/src/App.jsx`)

1. **Thêm Khối Tải Ảnh Poster & Quản Lý Rule (Poster Rule Builder)**:
   * Ô cho phép kéo thả/tải ảnh Poster thể lệ tháng đó.
   * Nút **"🤖 AI Trích Xuất Rule"** để tự động điền danh sách Hashtag, Tag Fanpage, Thời lượng tối thiểu vào form.
   * Cho phép lưu/chọn các **Mẫu Chiến Dịch (Campaign Presets)**.

2. **Xem Trước Mapping Cột Excel (Column Mapping Preview)**:
   * Hiển thị danh sách các cột tìm thấy trong file Excel để người dùng xác nhận đúng cột trước khi nhấn **🚀 Bắt đầu đánh giá**.

3. **Bảng Theo Dõi Kết Quả Chấm Thời Gian Thực (Live Execution Grid)**:
   * Hiển thị trạng thái chấm từng dòng: ĐK1 (Đạt/Không đạt), ĐK2 (Đạt/Không đạt), Kết quả (Đạt/Không đạt), Số View/Like/Comment/Share và thumbnail 2 ảnh đối chiếu.

---

## 4. BẢNG TÓM TẮT MÃ NGUỒN CẦN CHỈNH SỬA CHO ANTIGRAVITY

| File Cần Sửa | Mô tả công việc chi tiết |
| :--- | :--- |
| **`src/analyzer.js`** | Cập nhật Prompt JSON schema mới chuẩn ĐK1/ĐK2/Views; Viết hàm `extractRulesFromPoster`. |
| **`src/scraper.js`** | Bổ sung DOM/Visual selectors trích xuất Views, Video Duration; Viết hàm chụp 2 ảnh bằng chứng `proofScreen1` & `proofScreen2`. |
| **`src/excelProcessor.js`** | Viết lại logic dùng `exceljs` đọc/ghi file mẫu giữ nguyên công thức & định dạng; Xử lý cả Bảng Đơn & Bảng Nhiều Phiên. |
| **`src/server.js`** | Thêm API endpoint `/api/extract-poster-rules`, `/api/presets`; Cập nhật queue xử lý background job phù hợp cấu trúc mới. |
| **`frontend/src/App.jsx`** | Bổ sung UI Upload Poster, Preset Manager, Column Preview & Bảng kết quả ĐK1/ĐK2 trực quan. |

---
*Tài liệu đặc tả này chứa đầy đủ ngữ cảnh, cấu trúc dữ liệu thực tế và lộ trình kỹ thuật để bất kỳ Assistant Antigravity / Developer nào tiếp quản đều có thể triển khai code ngay lập tức mà không cần hỏi lại.*
