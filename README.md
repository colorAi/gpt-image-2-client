# 幻影G2生图独立客户端

## 同步版本号

发布新版本时运行：

```bash
npm run version:sync -- 1.2.3
```

脚本会同步 npm、Tauri、Cargo、Cargo.lock，以及网页和软件窗口顶部标题中的版本号。

这是从主项目拆出的本地 Tauri 图片生成客户端。它不依赖主项目的 Next 页面和登录状态，只需要填写主项目后端地址和 API Key。

## 使用

```bash
cd standalone-image-tool
npm install
npm run tauri:dev
```

客户端可在配置中心切换两个 API 渠道：

- 畅享版：`https://1kgpt.hootoo.dpdns.org`
- 稳定版：`https://api.hootoo.dpdns.org`

启动后在配置中心填写：

- API Key：主项目中可用的 admin/user key
- 本地结果目录：可选。选择后，生成成功的图片会按日期落盘保存。

## 功能

- 文生图：调用 `/api/image-tasks/generations` 提交后台任务
- 图生图/编辑：通过点击或拖拽上传参考图，调用 `/api/image-tasks/edits`
- 稳定版：调用 `/v1/images/async/generations` 或 `/v1/images/async/edits`，并支持 1K / 2K / 4K 分辨率
- 任务轮询：任务提交后进入列表，生成中可继续并发提交
- 本地结果：可扫描、预览和删除已保存到结果目录中的图片
- 提示词助手：调用 `/v1/chat/completions` 整理提示词

## 打包

```bash
npm run tauri:build
```

也可以直接双击：

- `build_tauri.command`：打 macOS `.app` 和 `.dmg`
- `build_tauri_windows.command`：在 macOS 上交叉打 Windows x64 安装包，并复制一份可直接启动的 exe 到 `dist-portable/windows-x64/`

图标来自 `dist/G.png`，已生成到 `src-tauri/icons/` 并在 Tauri bundle 配置中引用。Windows 打包使用 `icons/icon.ico`。
