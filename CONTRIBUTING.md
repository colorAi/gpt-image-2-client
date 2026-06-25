# 贡献指南

感谢你愿意改进这个项目。

## 开发流程

1. Fork 仓库并创建功能分支。
2. 运行 `npm install` 安装依赖。
3. 使用 `npm run tauri:dev` 启动桌面端开发环境。
4. 修改完成后运行 `npm run build`。
5. 提交 pull request，并说明改动目的、验证方式和潜在兼容性影响。

## 代码约定

- 优先保持现有 React、TypeScript、Tauri 和 Rust 代码风格。
- 不要把 API Key、个人配置、打包产物或本地结果图片提交到仓库。
- 涉及接口字段、任务状态、文件落盘逻辑的改动，请在 PR 中写清楚兼容范围。
- 新增用户可见功能时，请同步更新 `README.md`。

## 版本发布

发布前使用版本同步脚本：

```bash
npm run version:sync -- 1.2.3
```

脚本会同步 npm、Tauri、Cargo、Cargo.lock、网页标题和窗口标题中的版本号。
