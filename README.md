# FBEval Bot - Bot Đánh Giá Tự Động Bài Viết Facebook

FBEval Bot là ứng dụng web cục bộ chạy trên máy tính cá nhân của anh, hỗ trợ đánh giá tự động các bài viết mạng xã hội (chủ yếu là Facebook) dựa trên **Ảnh chụp màn hình thực tế** của bài viết phối hợp cùng **Trí tuệ nhân tạo Google Gemini 1.5 Flash (Multimodal LLM)**.

---

## 🌟 Tính Năng Nổi Bật

1. **Quét dữ liệu trực quan (Visual Scraping)**: Không dựa vào Class/ID của HTML (rất dễ lỗi khi Facebook đổi giao diện). Bot sử dụng **Playwright** mở trình duyệt thật, chụp lại ảnh màn hình bài viết để AI đọc trực tiếp tương tác và hình ảnh.
2. **Đăng nhập an toàn (Persistent Session)**: Anh chỉ cần đăng nhập tài khoản Facebook 1 lần duy nhất bằng nút bấm trên giao diện. Bot sẽ lưu lại cookie đăng nhập và tái sử dụng cho các lần quét sau (tránh bị chặn khi quét các bài viết).
3. **Phân tích Đa Phương Thức (Gemini AI)**: Tự động trích xuất Like, Comment, Share từ ảnh. Đánh giá chất lượng hình ảnh (độ nét, logo, tỉ lệ chữ) và nội dung chữ (chính tả, hashtag, CTA) theo bộ quy tắc tùy chỉnh.
4. **Nhập & Xuất báo cáo Excel**:
   - Tự động nhận diện cột chứa link Facebook từ file Excel anh tải lên.
   - Xuất file báo cáo Excel chi tiết chứa kết quả kiểm tra chất lượng, điểm số, nhận xét và link ảnh chụp màn hình bài viết để đối chiếu.

---

## 🛠️ Hướng Dẫn Sử Dụng

### Bước 1: Khởi động Bot
Mở PowerShell/CMD tại thư mục này và chạy lệnh:
```bash
npm start
```
*Lưu ý: Nếu chạy lần đầu tiên, hãy chạy lệnh `npm run setup` trước để tự động cài đặt các gói và tải trình duyệt Chrome cho Playwright.*

Sau khi khởi động thành công, mở trình duyệt và truy cập địa chỉ:
```
http://localhost:5000
```

### Bước 2: Cấu hình Khóa API
1. Đăng ký lấy một **Gemini API Key** miễn phí tại [Google AI Studio](https://aistudio.google.com/).
2. Dán API Key vào ô nhập trên giao diện.
3. Nhấp **Lưu Cấu Hình**.

### Bước 3: Đăng nhập Facebook (Quan trọng)
1. Nhấp nút **🔑 Đăng nhập Facebook** trên màn hình.
2. Một trình duyệt Chrome thực tế sẽ được mở ra.
3. Anh đăng nhập tài khoản Facebook của mình trên trình duyệt này rồi tắt trình duyệt đó đi. Phiên đăng nhập sẽ được lưu tự động cho các lần quét bài viết sau này.

### Bước 4: Nhập link và Chạy đánh giá
1. Tải lên file Excel tổng hợp link hoặc chọn tab **Nhập link thủ công** để dán link.
2. Nhấp **🚀 Bắt đầu đánh giá**.
3. Theo dõi tiến trình đánh giá trực tiếp trên giao diện.
4. Khi chạy xong, nhấp nút **📥 Xuất báo cáo Excel** để tải báo cáo tổng hợp về máy.

---

## 📁 Cấu trúc thư mục dự án

```
ĐỌC HÌNH ACTIVATION/
├── src/                      # Mã nguồn Backend (Express)
│   ├── server.js             # API Server
│   ├── scraper.js            # Quét dữ liệu & chụp màn hình (Playwright)
│   ├── analyzer.js           # Gửi ảnh sang Gemini AI phân tích
│   └── excelProcessor.js     # Đọc/ghi file Excel
├── frontend/                 # Mã nguồn Frontend (React + Vite)
│   ├── src/
│   │   ├── App.jsx           # Component chính của UI
│   │   ├── App.css           # CSS giao diện
│   │   └── main.jsx
│   └── dist/                 # Bản build của Frontend (chạy production)
├── data/
│   ├── user_profile/         # Lưu session đăng nhập Facebook
│   └── uploads/              # File tạm tải lên
└── public/
    ├── screenshots/          # Chứa ảnh chụp màn hình bài viết để xem trên UI
    └── exports/              # Chứa file Excel báo cáo kết quả
```

## ⚙️ Yêu cầu hệ thống
* Node.js v18 trở lên.
* Kết nối Internet để gọi API Gemini và mở trình duyệt.
