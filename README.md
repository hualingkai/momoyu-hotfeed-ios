# 全网热点 & 订阅源管理

移动端优先的全网热点聚合与 RSS/Atom/JSON Feed 订阅源管理应用。

## 目录结构

- `server/`：FastAPI 后端（订阅源解析、SSRF/XXE 防护、SQLite 持久化、统一后台采集调度、热榜聚合）
- `web/`：React + Vite + Tailwind CSS 前端（含 `capacitor.config.json`，支持后续打包 iOS `.ipa` 安装至 LiveContainer）

## 本地运行

### 1. 启动后端
```powershell
cd server
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```

### 2. 启动前端
```powershell
cd web
npm run dev
```
访问 `http://localhost:5173`。

## 运行后端测试
```powershell
cd server
.\.venv\Scripts\python.exe -m pytest -v tests/test_sources.py
```

## 打包 iOS `.ipa`（用于 LiveContainer）
在 macOS（或 GitHub Actions macOS Runner）上执行：
```bash
cd web
VITE_API_BASE=https://你的后端域名 npm run build
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap sync ios
```
随后在 Xcode 中 Archive 导出无签名/自签名 `.ipa`，即可导入 iOS LiveContainer 运行。
