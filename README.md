# De Stijl Studio

> 將風格派的格線、原色與比例，轉譯為可探索、可重現、可輸出的生成式設計工具。

## 操作方式

調整欄列、黑線粗細與五種色彩比例，按「產生新構圖」探索變體。每張作品都附有六位數 Seed，可回溯同一組結果，並可匯出為 1800px PNG。

## 設計與技術亮點

- **比例守恆**：調整一種色彩時，系統自動平衡其他比例，總和固定為 100%。
- **可重現的偶然**：以 seeded pseudo-random generator 保存探索過程中的作品版本。
- **構圖演算法**：先配置主要矩形、再以方向性長條填滿，分色時兼顧配額與相鄰色彩排斥。
- **響應式操作介面**：桌面採雙欄工作區，行動裝置改為直式閱讀與操作流程。

## 本機執行

```bash
npm ci
npm run dev
```

在瀏覽器開啟 `http://localhost:3000`。

## 專案結構

```text
app/
├── layout.tsx                  # 網站語言與作品集 SEO 資訊
├── page.tsx                    # 首頁入口
└── globals.css                 # 視覺系統與響應式版面
src/components/
└── DeStijlGenerator.tsx        # 演算法、Canvas 繪製、完整互動控制
```

## 研究所推甄作品摘要

詳見 [PORTFOLIO.md](PORTFOLIO.md)。本專案由 Kent Chen 完成，聚焦於創意程式設計、參數化視覺系統與互動式生成設計。

## 授權

MIT License。
