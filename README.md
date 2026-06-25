# 幻影G2生图独立客户端

一个从主项目拆分出来的本地 Tauri 图片生成客户端。它不依赖主项目的 Next.js 页面和登录态，用户只需要在应用内填写后端 API Key，并选择本地结果目录，就可以提交图片生成、编辑和批量任务。

## 功能特性

- 文生图：提交 `/api/image-tasks/generations` 后台任务。
- 图生图/编辑：支持点击选择或拖拽上传参考图，提交 `/api/image-tasks/edits`。
- 稳定版渠道：调用 `/v1/images/async/generations`、`/v1/images/async/edits`，支持 1K、2K、4K 分辨率。
- 任务轮询：任务提交后进入列表，生成过程中可以继续并发提交。
- 本地结果：生成成功后按日期落盘，可扫描、预览、删除和复用为参考图。
- 提示词助手：调用 `/v1/chat/completions` 整理提示词。
- 主题切换：内置默认主题和端午主题。

## 技术栈

- React 19 + TypeScript
- Vite
- Tauri 2
- Rust 后端命令层

## 开始使用

### 环境要求

- Node.js 20 或更高版本
- npm
- Rust stable
- Tauri 2 所需的系统依赖

Tauri 的系统依赖会随平台不同而变化，首次配置请参考官方文档：<https://v2.tauri.app/start/prerequisites/>

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run tauri:dev
```

只启动前端开发服务：

```bash
npm run dev
```

### 应用配置

启动后在配置中心填写：

- API Key：后端可用的 admin/user key。
- API 渠道：
  - 畅享版：`https://1kgpt.hootoo.dpdns.org`
  - 稳定版：`https://api.hootoo.dpdns.org`
- 本地结果目录：必选。选择后，生成成功的图片会按日期保存到本地，并生成缩略图。

API Key 和本地设置保存在 Tauri 应用数据目录中，不会提交到仓库。请不要把自己的真实 Key 写入源码、截图或 issue。

## 常用脚本

```bash
npm run build
npm run tauri:build
npm run version:sync -- 1.2.3
```

- `npm run build`：类型检查并构建前端产物。
- `npm run tauri:build`：构建桌面应用。
- `npm run version:sync -- 1.2.3`：同步 npm、Tauri、Cargo、Cargo.lock、网页标题和窗口标题中的版本号。

也可以直接双击脚本打包：

- `build_tauri.command`：构建 macOS `.app` 和 `.dmg`。
- `build_tauri_windows.command`：在 macOS 上交叉构建 Windows x64 安装包，并复制一份可直接启动的 exe 到 `dist-portable/windows-x64/`。

## 后端接口兼容

客户端默认内置两个 API 渠道。如果你要接入自己的后端，可以 fork 后调整：

- `src/constants.ts`：前端渠道名称和默认地址。
- `src-tauri/src/lib.rs`：Rust 侧兼容旧配置时使用的默认地址。
- `src/api.ts`：具体任务接口、字段和响应归一化逻辑。

当前实现会使用 Bearer Token 访问后端，并通过 Tauri/Rust 层代理请求，避免浏览器跨域限制影响桌面客户端。

## 目录结构

```text
.
├── src/                  # React 前端
├── src-tauri/            # Tauri/Rust 桌面端
├── public/               # 静态图片资源
├── scripts/              # 版本同步和本地修复脚本
├── build_tauri.command   # macOS 打包脚本
└── build_tauri_windows.command
```

## 开源协作

欢迎提交 issue 和 pull request。较大的功能改动建议先开 issue 讨论接口、交互和兼容性，避免重复实现。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请参考 [SECURITY.md](SECURITY.md)。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
