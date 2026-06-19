import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextVersion = process.argv[2]?.trim();

// Version targets: keep this list as the single checklist when adding new release metadata.
const VERSION_TARGETS = [
  "package.json: version",
  "package-lock.json: root package versions",
  "src-tauri/tauri.conf.json: app version and window title",
  "src-tauri/Cargo.toml: package version",
  "src-tauri/Cargo.lock: phantom_image_client package version",
  "index.html: browser title",
];

if (!nextVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error("用法：npm run version:sync -- 1.2.3");
  console.error("\n同步目标：\n- " + VERSION_TARGETS.join("\n- "));
  process.exit(1);
}

function resolveFile(relativePath) {
  return path.join(rootDir, relativePath);
}

function readText(relativePath) {
  return fs.readFileSync(resolveFile(relativePath), "utf8");
}

function writeText(relativePath, content) {
  fs.writeFileSync(resolveFile(relativePath), content);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function writeJson(relativePath, value) {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`未找到版本目标：${label}`);
  }
  return content.replace(pattern, replacement);
}

const packageJson = readJson("package.json");
packageJson.version = nextVersion;

const packageLock = readJson("package-lock.json");
packageLock.version = nextVersion;
if (!packageLock.packages?.[""]) {
  throw new Error("未找到版本目标：package-lock.json root package");
}
packageLock.packages[""].version = nextVersion;

const tauriConfig = replaceRequired(
  replaceRequired(
    readText("src-tauri/tauri.conf.json"),
    /("version": ")[^"]+(")/,
    `$1${nextVersion}$2`,
    "src-tauri/tauri.conf.json version",
  ),
  /("title": "[^"]*--v\s+)[^"]+(")/,
  `$1${nextVersion}$2`,
  "src-tauri/tauri.conf.json window title",
);

const cargoToml = replaceRequired(
  readText("src-tauri/Cargo.toml"),
  /(\[package\][\s\S]*?\nversion = ")[^"]+(")/,
  `$1${nextVersion}$2`,
  "src-tauri/Cargo.toml package.version",
);

const cargoLock = replaceRequired(
  readText("src-tauri/Cargo.lock"),
  /(\[\[package\]\]\nname = "phantom_image_client"\nversion = ")[^"]+(")/,
  `$1${nextVersion}$2`,
  "src-tauri/Cargo.lock phantom_image_client.version",
);

const indexHtml = replaceRequired(
  readText("index.html"),
  /(<title>[\s\S]*?--v\s+)[^<\s]+(\s*<\/title>)/,
  `$1${nextVersion}$2`,
  "index.html title",
);

// Validate every target before writing, so a missing marker never leaves a partial upgrade.
writeJson("package.json", packageJson);
writeJson("package-lock.json", packageLock);
writeText("src-tauri/tauri.conf.json", tauriConfig);
writeText("src-tauri/Cargo.toml", cargoToml);
writeText("src-tauri/Cargo.lock", cargoLock);
writeText("index.html", indexHtml);

console.log(`版本已同步为 ${nextVersion}`);
console.log("- " + VERSION_TARGETS.join("\n- "));
