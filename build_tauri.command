#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:/Users/hongtao/.cargo/bin:$PATH"

PROJECT_DIR="$(pwd)"
REPAIR_SCRIPT="$PROJECT_DIR/scripts/修复应用已损坏.command"
REPAIR_FILE_NAME="如果提示应用已损坏，请双击修复.command"
BUILD_TARGET="universal-apple-darwin"
BUILD_ROOT="src-tauri/target/$BUILD_TARGET/release"
BUNDLE_ROOT="$BUILD_ROOT/bundle"

echo "=========================================="
echo "     幻影畅享版 Tauri macOS Build"
echo "=========================================="
echo
echo "Project: phantom-image-client"
echo "Target: Universal macOS (Apple Silicon + Intel)"
echo "Running: npm run tauri:build:mac -- --target $BUILD_TARGET"
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
  for RUST_TARGET in aarch64-apple-darwin x86_64-apple-darwin; do
    if ! rustup target list --installed | grep -q "^$RUST_TARGET$"; then
      echo "Installing Rust target: $RUST_TARGET"
      rustup target add "$RUST_TARGET"
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
  done
fi

npm run tauri:build:mac -- --target "$BUILD_TARGET"
BUILD_EXIT_CODE=$?

echo
if [ "$BUILD_EXIT_CODE" -ne 0 ]; then
  echo "macOS build failed with exit code $BUILD_EXIT_CODE."
else
  APP_PATH=$(ls -dt "$BUNDLE_ROOT"/macos/*.app 2>/dev/null | head -n 1)
  DMG_PATH=$(ls -t "$BUNDLE_ROOT"/dmg/*.dmg 2>/dev/null | head -n 1)
  DMG_BUILDER="$BUNDLE_ROOT/dmg/bundle_dmg.sh"
  DMG_ICON="$BUNDLE_ROOT/dmg/icon.icns"

  if [ -n "$APP_PATH" ]; then
    echo "Signing app bundle with ad-hoc identity..."
    codesign -s - --force --deep "$APP_PATH"
    SIGN_EXIT_CODE=$?
    if [ "$SIGN_EXIT_CODE" -ne 0 ]; then
      echo "Ad-hoc signing failed with exit code $SIGN_EXIT_CODE."
      BUILD_EXIT_CODE="$SIGN_EXIT_CODE"
    else
      echo "Ad-hoc signing succeeded."
    fi
  fi

  if [ "$BUILD_EXIT_CODE" -eq 0 ] && [ -n "$APP_PATH" ] && [ -n "$DMG_PATH" ] && [ -f "$DMG_BUILDER" ] && [ -f "$REPAIR_SCRIPT" ]; then
    echo "Adding the macOS repair shortcut to the DMG..."
    chmod +x "$REPAIR_SCRIPT"
    rm -f "$DMG_PATH"
    "$DMG_BUILDER" \
      --volname "幻影畅享版" \
      --volicon "$DMG_ICON" \
      --window-size 680 430 \
      --icon-size 112 \
      --icon "$(basename "$APP_PATH")" 170 170 \
      --app-drop-link 510 170 \
      --add-file "$REPAIR_FILE_NAME" "$REPAIR_SCRIPT" 340 330 \
      "$DMG_PATH" \
      "$(dirname "$APP_PATH")"
    BUILD_EXIT_CODE=$?
  elif [ "$BUILD_EXIT_CODE" -eq 0 ]; then
    echo "Unable to add the repair shortcut: required DMG build files were not found."
    BUILD_EXIT_CODE=1
  fi

  echo
fi

if [ "$BUILD_EXIT_CODE" -eq 0 ]; then
  echo "macOS build completed successfully."
  echo
  echo "Bundles:"
  if [ -n "$APP_PATH" ]; then
    echo "$APP_PATH"
  fi
  if [ -n "$DMG_PATH" ]; then
    echo "$DMG_PATH"
  fi
  if [ -z "$APP_PATH" ] && [ -z "$DMG_PATH" ]; then
    echo "$BUNDLE_ROOT/"
  fi
  echo
  echo "Executable:"
  echo "$BUILD_ROOT/phantom_image_client"
else
  echo "macOS packaging did not complete."
fi
echo
read -r -p "Press Enter to close..."
exit "$BUILD_EXIT_CODE"
