#!/bin/bash

APP_PATH="/Applications/幻影畅享版.app"

clear
echo "=========================================="
echo "       幻影畅享版 macOS 启动修复工具"
echo "=========================================="
echo
echo "此工具仅用于处理 macOS 提示“应用已损坏，无法打开”的情况。"
echo

if [ ! -d "$APP_PATH" ]; then
  echo "未找到：$APP_PATH"
  echo
  echo "请先把“幻影畅享版”拖入 Applications（应用程序）文件夹，"
  echo "然后再次双击此修复工具。"
  echo
  read -r -p "按回车键关闭..."
  exit 1
fi

echo "即将请求管理员授权，并清除该应用的隔离标记。"
echo "macOS 弹出密码窗口时，请输入当前电脑的登录密码。"
echo

/usr/bin/osascript <<APPLESCRIPT
do shell script "/usr/bin/xattr -rd com.apple.quarantine " & quoted form of "$APP_PATH" with administrator privileges
APPLESCRIPT
REPAIR_EXIT_CODE=$?

echo
if [ "$REPAIR_EXIT_CODE" -ne 0 ]; then
  echo "修复未完成，可能是管理员授权被取消。"
  echo
  read -r -p "按回车键关闭..."
  exit "$REPAIR_EXIT_CODE"
fi

echo "修复完成，正在打开“幻影畅享版”..."
/usr/bin/open "$APP_PATH"
echo
read -r -p "按回车键关闭..."
