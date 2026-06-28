# 幻影G2生图独立客户端

![幻影G2生图独立客户端界面预览](public/G2.png)

语言 / Language: [中文](#中文) | [English](#english)

## 中文

幻影G2生图独立客户端，支持 chatgpt2api 和 sub2api 项目。用户在应用内填写服务地址、API Key 和本地结果目录后，就可以提交图片生成、编辑和批量任务。

### 下载

- 仓库下载：可以在 [GitHub Releases](https://github.com/colorAi/gpt-image-2-client/releases) 页面下载已打包客户端。
- 网盘下载：<https://pan.quark.cn/s/3da05efbef6e>

### 功能特性

- 文生图与图生图：支持 chatgpt2api 和 sub2api，可在两个渠道间切换。
- 参考图工作流：支持点击上传、拖拽图片、剪贴板粘贴截图，最多添加 8 张参考图。
- 本地自动保存：生成成功后按日期保存图片、缩略图、提示词和任务信息。
- 提示词保留与回填：预览图片时可查看保存的提示词，一键复制或回填到输入框继续修改。
- 一键加入参考图：任务结果和本地结果都可以直接加入参考图，快速进入图生图/编辑流程。
- 批量与拆分提交：支持多任务并发、提示词按空行拆分提交，并显示排队与运行状态。
- AI 提示词助手：整理提示词、提示词中英互译，并可根据参考图反推提示词。
- 本地结果管理：按日期扫描、分页浏览、预览、删除本地图片。
- 主题切换：内置默认主题和端午主题。

### 技术栈

- React 19 + TypeScript
- Vite
- Tauri 2
- Rust 后端命令层

### 开始使用

环境要求：

- Node.js 20 或更高版本
- npm
- Rust stable
- Tauri 2 所需的系统依赖

Tauri 的系统依赖会随平台不同而变化，首次配置请参考官方文档：<https://v2.tauri.app/start/prerequisites/>

安装依赖：

```bash
npm install
```

开发运行：

```bash
npm run tauri:dev
```

只启动前端开发服务：

```bash
npm run dev
```

### 应用配置

启动后在配置中心填写：

- 服务地址：分别填写自己的 chatgpt2api 或 sub2api Base URL。
- API Key：后端可用的 admin/user key。
- API 渠道：
  - 畅享版：支持 chatgpt2api 任务接口。
  - 稳定版：支持 sub2api，优先使用异步任务接口，也兼容非异步 `/v1/images/*` 接口。
- 本地结果目录：必选。选择后，生成成功的图片会按日期保存到本地，并生成缩略图。

API Key 和本地设置保存在 Tauri 应用数据目录中，不会提交到仓库。请不要把真实 Key 写入源码、截图或 issue。

### 常用脚本

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

### 后端接口兼容

客户端默认提供两个 API 渠道，并允许用户在配置中心为每个渠道填写自己的服务地址。如果你要调整接口模式，可以修改：

- `src/constants.ts`：前端渠道名称和默认配置。
- `src-tauri/src/lib.rs`：Rust 侧配置读取与请求代理。
- `src/api.ts`：具体任务接口、字段和响应归一化逻辑。

当前实现会使用 Bearer Token 访问后端，并通过 Tauri/Rust 层代理请求，避免浏览器跨域限制影响桌面客户端。

### 目录结构

```text
.
├── src/                  # React 前端
├── src-tauri/            # Tauri/Rust 桌面端
├── public/               # 静态图片资源
├── scripts/              # 版本同步和本地修复脚本
├── build_tauri.command   # macOS 打包快捷脚本
└── build_tauri_windows.command
```

### 协作

欢迎提交 issue 和 pull request。较大的功能改动建议先开 issue 讨论接口、交互和兼容性，避免重复实现。

### 许可证

本项目基于 [GNU AGPL-3.0-only](LICENSE) 发布。修改、分发或通过网络提供服务时，请遵守 AGPL-3.0 的源码公开要求；如需闭源集成、私有化交付或商业授权，请联系 409993197（注明来意）。

## English

Phantom G2 Image Client is a standalone desktop client for image generation workflows built around chatgpt2api and sub2api. Enter your own service URL, API key, and local output directory in the app, then submit generation, edit, and batch tasks.

### Download

- Repository downloads: packaged clients can be downloaded from [GitHub Releases](https://github.com/colorAi/gpt-image-2-client/releases).
- Quark Cloud Drive: <https://pan.quark.cn/s/3da05efbef6e>

### Features

- Text-to-image and image-to-image workflows for chatgpt2api and sub2api, with quick channel switching.
- Reference image workflow: upload, drag and drop, or paste screenshots from the clipboard, with up to 8 reference images.
- Automatic local saving: successful results are saved by date with thumbnails, prompts, and task metadata.
- Prompt preservation and reuse: view saved prompts in the preview, then copy or fill them back into the editor.
- One-click reference reuse: add task results or local results directly as reference images for image edits.
- Batch and split submission: run concurrent tasks, split prompts by blank lines, and track queued/running status.
- AI prompt tools: prompt cleanup, Chinese/English translation, and image-to-prompt reverse prompting from references.
- Local result management: scan by date, browse with pagination, preview, and delete local images.
- Built-in default and Dragon Boat themes.

### Stack

- React 19 + TypeScript
- Vite
- Tauri 2
- Rust command layer

### Getting Started

Requirements:

- Node.js 20 or newer
- npm
- Rust stable
- Tauri 2 platform prerequisites

See the Tauri prerequisite guide for platform-specific setup: <https://v2.tauri.app/start/prerequisites/>

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run tauri:dev
```

Run only the frontend dev server:

```bash
npm run dev
```

### App Configuration

Configure these values in the settings panel:

- Service URL: your own chatgpt2api or sub2api Base URL.
- API Key: a valid admin/user key from your backend.
- API channel:
  - Dream: chatgpt2api task endpoints.
  - Stable: sub2api async endpoints, with fallback support for non-async `/v1/images/*`.
- Local output directory: required. Successful images are saved locally by date with thumbnails.

API keys and local settings are stored in the Tauri app data directory and are not committed to this repository. Do not paste real keys into source code, screenshots, or issues.

### Scripts

```bash
npm run build
npm run tauri:build
npm run version:sync -- 1.2.3
```

- `npm run build`: type-check and build the frontend.
- `npm run tauri:build`: build the desktop app.
- `npm run version:sync -- 1.2.3`: sync version metadata across npm, Tauri, Cargo, Cargo.lock, and app titles.

Helper scripts are also available:

- `build_tauri.command`: build macOS `.app` and `.dmg`.
- `build_tauri_windows.command`: cross-build Windows x64 from macOS and copy a portable exe to `dist-portable/windows-x64/`.

### Backend Compatibility

The app provides two API channels and lets users set a separate service URL for each channel. To customize the behavior, edit:

- `src/constants.ts`: frontend channel names and default config.
- `src-tauri/src/lib.rs`: Rust-side config loading and request proxying.
- `src/api.ts`: task endpoints, request fields, and response normalization.

Requests use Bearer tokens and are proxied through the Tauri/Rust layer to avoid browser CORS issues in the desktop client.

### Project Layout

```text
.
├── src/                  # React frontend
├── src-tauri/            # Tauri/Rust desktop layer
├── public/               # Static assets
├── scripts/              # Version sync and local repair scripts
├── build_tauri.command   # macOS build helper
└── build_tauri_windows.command
```

### Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss API behavior, UI flow, and compatibility.

### License

This project is released under [GNU AGPL-3.0-only](LICENSE). If you modify, distribute, or provide the software over a network, comply with the AGPL-3.0 source disclosure requirements. For closed-source integration, private delivery, or commercial licensing, contact 409993197 and describe your purpose.
