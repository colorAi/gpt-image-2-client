#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/opt/llvm/bin:/opt/homebrew/bin:/Users/hongtao/.cargo/bin:$PATH"
APP_NAME="幻影畅享版"
APP_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")

echo "=========================================="
echo "     幻影畅享版 Tauri Windows x64 Build"
echo "=========================================="
echo
echo "Project: phantom-image-client"
echo "Output: ${APP_NAME}_${APP_VERSION}_x64.exe"
echo "Running: npm run build:windows:x64 -- --no-sign"
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

if command -v rustup >/dev/null 2>&1; then
  if ! rustup target list --installed | grep -q '^x86_64-pc-windows-msvc$'; then
    echo "Installing Rust target: x86_64-pc-windows-msvc"
    rustup target add x86_64-pc-windows-msvc
    TARGET_EXIT_CODE=$?
    if [ "$TARGET_EXIT_CODE" -ne 0 ]; then
      echo
      echo "Rust target install failed with exit code $TARGET_EXIT_CODE."
      echo
      read -r -p "Press Enter to close..."
      exit "$TARGET_EXIT_CODE"
    fi
    echo
  fi
fi

if ! command -v cargo-xwin >/dev/null 2>&1; then
  echo "cargo-xwin not found. Installing cargo-xwin for macOS -> Windows builds..."
  cargo install cargo-xwin
  XWIN_EXIT_CODE=$?
  if [ "$XWIN_EXIT_CODE" -ne 0 ]; then
    echo
    echo "cargo-xwin install failed with exit code $XWIN_EXIT_CODE."
    echo "You can also build this project on Windows with: npm run tauri:build"
    echo
    read -r -p "Press Enter to close..."
    exit "$XWIN_EXIT_CODE"
  fi
  echo
fi

npm run build:windows:x64 -- --no-sign
BUILD_EXIT_CODE=$?

echo
if [ "$BUILD_EXIT_CODE" -ne 0 ]; then
  echo "Windows x64 build failed with exit code $BUILD_EXIT_CODE."
else
  echo "Windows x64 build completed successfully."
  RELEASE_DIR="src-tauri/target/x86_64-pc-windows-msvc/release"
  PORTABLE_DIR="dist-portable/windows-x64"
  RELEASE_EXE="$RELEASE_DIR/${APP_NAME}_${APP_VERSION}_x64.exe"
  PORTABLE_EXE="$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64.exe"
  SOURCE_EXE="$RELEASE_DIR/${APP_NAME}.exe"
  FALLBACK_SOURCE_EXE="$RELEASE_DIR/phantom_image_client.exe"
  mkdir -p "$PORTABLE_DIR"
  rm -f "$RELEASE_DIR/${APP_NAME}_"*_x64.exe
  rm -f "$PORTABLE_DIR/${APP_NAME}_"*_x64.exe
  rm -f "$PORTABLE_DIR/${APP_NAME}_"*_x64_setup.exe
  rm -f "$PORTABLE_DIR/${APP_NAME}_"*_x64.msi
  if [ ! -f "$SOURCE_EXE" ] && [ -f "$FALLBACK_SOURCE_EXE" ]; then
    SOURCE_EXE="$FALLBACK_SOURCE_EXE"
  fi
  if [ -f "$SOURCE_EXE" ]; then
    cp "$SOURCE_EXE" "$RELEASE_EXE"
    cp "$SOURCE_EXE" "$PORTABLE_EXE"
    rm -f "$FALLBACK_SOURCE_EXE"
  fi
  echo
  echo "Installers:"
  INSTALLER_PATH=$(ls -t src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*setup.exe 2>/dev/null | head -n 1)
  MSI_PATH=$(ls -t src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi 2>/dev/null | head -n 1)
  if [ -n "$INSTALLER_PATH" ]; then
    echo "$INSTALLER_PATH"
    cp "$INSTALLER_PATH" "$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64_setup.exe"
  fi
  if [ -n "$MSI_PATH" ]; then
    echo "$MSI_PATH"
    cp "$MSI_PATH" "$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64.msi"
  fi
  if [ -z "$INSTALLER_PATH" ] && [ -z "$MSI_PATH" ]; then
    echo "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/"
  fi
  echo
  echo "Portable executable:"
  if [ -f "$RELEASE_EXE" ]; then
    echo "$RELEASE_EXE"
  fi
  if [ -f "$PORTABLE_EXE" ]; then
    echo "$PORTABLE_EXE"
  else
    echo "Not found: $SOURCE_EXE"
  fi
  if [ -f "$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64_setup.exe" ]; then
    echo "$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64_setup.exe"
  fi
  if [ -f "$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64.msi" ]; then
    echo "$PORTABLE_DIR/${APP_NAME}_${APP_VERSION}_x64.msi"
  fi
fi
echo
read -r -p "Press Enter to close..."
exit "$BUILD_EXIT_CODE"
