# Companion Bot — checklist kiểm thử thủ công (hai tab)

Companion Bot (`engine/ingame/companion/`) không thể kiểm thử đầy đủ bằng Node —
phần logic thuần (`companionResolveBoss`, `companionPickSpawnTile`,
`companionCollectCommands`, `companionTick`, …) đã có test tự động trong
`test/companion.mjs` (`npm test`), nhưng hành vi thật trong game (socket, UI,
hai tab cùng một trận) chỉ kiểm chứng được bằng tay, trong trình duyệt.

Checklist này dùng để verify thủ công sau khi build (`npm run build`) và trước
khi coi tính năng là "xong". Chưa ai chạy qua checklist này — đừng đánh dấu các
mục dưới đây là đã hoàn tất cho tới khi tự tay kiểm tra trong game.

## Chuẩn bị

1. `npm run build` (hoặc `npm run build:raw` nếu muốn xem log debug trong console).
2. Cài `openfront-helper.user.js` vào Tampermonkey/Violentmonkey ở cả hai trình
   duyệt/profile bạn dùng để mở 2 tab.
3. Mở **hai tab** vào **cùng một trận** bằng **hai tài khoản khác nhau**
   (2 profile/trình duyệt khác nhau, hoặc 2 cửa sổ ẩn danh riêng biệt — OpenFront
   không cho hai tab cùng tài khoản chơi cùng lúc).
   - **Tab A = "boss"** — người chơi chính, không bật Companion.
   - **Tab B = "companion"** — tab phụ, sẽ bật Companion mode để phục vụ tab A.

## Kiểm tra nhanh bằng console (thay cho bước "hỏi window.\_\_companionDiag()")

Trên **bất kỳ tab nào đang trong trận**, mở DevTools Console và chạy:

```js
window.__companionDiag();
```

Kỳ vọng: trả về một object đầy đủ các khóa `enabled`, `settings`, `bossStatus`,
`bossSmallID`, `paused`, `queued`, `factoryLevel`, `gameFound`, `humans`,
`bindings`, `lastSendFailedAt`, `logLines` — không `undefined`, không ném lỗi.
(Phần logic dựng object này đã được xác nhận bằng một harness Node riêng khi
triển khai Task 12 — xem `.superpowers/sdd/task-12-report.md` — nhưng đó chỉ mô
phỏng bằng stub; **chạy đúng trong trình duyệt thật vẫn cần bạn tự làm** vì
lúc đó `getOpenFrontGameContext()` trả về `GameView` thật thay vì `null`.)

## Checklist 16 mục

Đánh dấu ✅ khi mục đó đã tự tay kiểm tra và đúng như mô tả. Nếu sai khác, ghi
chú lại console log / ảnh chụp màn hình trước khi báo cáo.

- [ ] **1.** Trên tab B, bật `Companion mode` từ Quick Panel (mục **Companion**) →
      panel Companion hiện ra (3 tab: Control / Emoji / Log).
- [ ] **2.** Trong panel Companion (tab B), nhập đúng tên tab A vào ô **Boss** →
      chấm trạng thái chuyển **xanh** (found). Gõ sai một ký tự trong tên →
      chấm chuyển **đỏ** (missing); console **không** có lỗi nào xuất hiện.
- [ ] **3.** Bấm nút `▾` cạnh ô Boss → hiện danh sách người chơi thật đang có
      trong trận, chọn một tên trong danh sách gán được vào ô Boss.
- [ ] **4.** Trong giai đoạn spawn (spawn phase) của trận, tab B tự spawn trong
      vành đai bán kính 12–24 ô quanh vị trí spawn của tab A (không cần đúng
      từng ô — kiểm tra bằng mắt trên minimap là đủ).
- [ ] **5.** Tab A gửi lời mời liên minh (alliance request) cho tab B → tab B tự
      động nhận (không cần tab B thao tác gì).
- [ ] **6.** Khi quân số của tab A xuống dưới 60% quân tối đa → tab B tự động
      nạp quân cho tab A (xem tab **Log** của panel Companion trên tab B để xác
      nhận dòng log tương ứng, ví dụ "🎖 Troops → boss").
- [ ] **7.** Tab A gửi riêng emoji 🆘 cho tab B (nhắm đích là tab B, không phải
      "All players") → tab B nạp **toàn bộ** vàng hiện có cho tab A.
- [ ] **8.** Tab A gửi emoji 💔 tới **"All players"** → **mọi** tab đang bật
      Companion (không chỉ tab B) đều hủy liên minh với boss của mình.
- [ ] **9.** Lặp lại đúng bước 7 (gửi lại 🆘 riêng cho tab B lần nữa, sau khi
      lần đầu đã chạy xong) → lệnh chạy lại bình thường, **không** bị cơ chế
      dedupe (chống lặp) chặn nhầm lần gửi mới.
- [ ] **10.** Dải cảnh báo (banner) hiện cố định ở mép trên màn hình tab B và
      **không có nút tắt nào** trên chính dải đó; đóng panel Companion bằng nút
      ✕ thì dải cảnh báo **vẫn còn hiển thị**.
- [ ] **11.** Bấm chuột và kéo (drag) tại vị trí **xuyên qua** dải cảnh báo (ví
      dụ kéo camera bản đồ ngay dưới dải) — thao tác vẫn điều khiển được game
      bình thường, xác nhận dải cảnh báo có `pointer-events: none`.
- [ ] **12.** Dải cảnh báo đổi màu đúng theo trạng thái: - **hổ phách (amber)** khi boss được tìm thấy (`bossStatus === "found"`); - **đỏ** khi tên boss gõ sai / không tìm thấy (`bossStatus === "missing"`); - **xám** khi bấm nút tạm dừng 🥱 (paused).
- [ ] **13.** Tab A (không bật Companion mode) **hoàn toàn không có** dải cảnh
      báo nào hiển thị.
- [ ] **14.** Bật lại `Companion mode` = **OFF** trên tab B → `window.__autoBotDiag()`
      trên tab B vẫn trả về object đầy đủ như bình thường; auto-bot (nếu đang
      bật) chơi tiếp không đổi hành vi so với trước khi có Companion.
- [ ] **15.** Đóng panel Companion bằng nút ✕ → toggle `Companion bot panel`
      trong Quick Panel (mục Companion) tự động chuyển về **tắt** theo (đồng
      bộ hai chiều).
- [ ] **16.** Reload lại trang (F5) → mọi cấu hình Companion trên tab B (tên
      boss, mode, các switch/số đã chỉnh, emoji bindings) **còn nguyên**, không
      bị reset về mặc định.

## Sau khi kiểm tra xong

Ghi lại kết quả (mục nào pass, mục nào fail kèm mô tả) vào
`.superpowers/sdd/task-12-report.md` hoặc báo trực tiếp cho người yêu cầu, rồi
mới coi Task 12 / tính năng Companion Bot là hoàn tất.
