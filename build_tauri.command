#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:/Users/hongtao/.cargo/bin:$PATH"

echo "=========================================="
echo "     幻影畅享版 Tauri macOS Build"
echo "=========================================="
echo
echo "Project: phantom-image-client"
echo "Running: npm run tauri:build:mac -- --no-sign"
echo

if [ ! -d "node_modules" ]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
  INSTALL_EXIT_CODE=$?
  if [ "$INSTALL_EXIT_CODE" -ne 0 ]; then
    echo
    echo "npm install failed with exit code $INSTALL_EXIT_CODE."
    echo
    read -r -p "Press Enter to close..."
    exit "$INSTALL_EXIT_CODE"
  fi
  echo
fi

npm run tauri:build:mac -- --no-sign
BUILD_EXIT_CODE=$?

echo
if [ "$BUILD_EXIT_CODE" -ne 0 ]; then
  echo "macOS build failed with exit code $BUILD_EXIT_CODE."
else
  echo "macOS build completed successfully."
  echo
  echo "Bundles:"
  APP_PATH=$(ls -dt src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -n 1)
  DMG_PATH=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -n 1)
  if [ -n "$APP_PATH" ]; then
    echo "$APP_PATH"
  fi
  if [ -n "$DMG_PATH" ]; then
    echo "$DMG_PATH"
  fi
  if [ -z "$APP_PATH" ] && [ -z "$DMG_PATH" ]; then
    echo "src-tauri/target/release/bundle/"
  fi
  echo
  echo "Executable:"
  echo "src-tauri/target/release/phantom_image_client"
fi
echo
read -r -p "Press Enter to close..."
exit "$BUILD_EXIT_CODE"
