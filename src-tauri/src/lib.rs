use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Local, NaiveDate};
use image::codecs::jpeg::JpegEncoder;
use reqwest::{multipart, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    cmp::Ordering,
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, Runtime};
use tokio::{fs as async_fs, io::AsyncWriteExt};
use walkdir::WalkDir;

const CONNECTION_FILE: &str = "connection.json";
const HISTORY_FILE: &str = "tasks.json";
const SETTINGS_FILE: &str = "settings.json";
const FIXED_BASE_URL: &str = "https://1kgpt.hootoo.dpdns.org";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Connection {
    base_url: String,
    api_key: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    result_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequestPayload {
    connection: Connection,
    path: String,
    method: Option<String>,
    body: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadedFile {
    name: String,
    data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultipartRequestPayload {
    connection: Connection,
    path: String,
    fields: Vec<(String, String)>,
    files: Vec<UploadedFile>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TaskImageItem {
    b64_json: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTaskImagesPayload {
    connection: Connection,
    result_dir: String,
    task_id: String,
    prompt: String,
    local_created_at: String,
    local_sort_key: Option<String>,
    data: Vec<TaskImageItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HydrateTaskImagesPayload {
    connection: Connection,
    data: Vec<TaskImageItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalImage {
    id: String,
    rel: String,
    name: String,
    path: String,
    thumbnail_path: Option<String>,
    prompt: Option<String>,
    created_at: String,
    local_created_at: String,
    size: u64,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalImagePage {
    items: Vec<LocalImage>,
    total: usize,
    page: usize,
    page_size: usize,
    dates: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageMetadata {
    task_id: String,
    prompt: String,
    local_created_at: String,
    local_sort_key: Option<String>,
}

fn app_data_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取应用数据目录失败：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("创建应用数据目录失败：{error}"))?;
    Ok(dir)
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path, fallback: T) -> T {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<T>(&text).ok())
        .unwrap_or(fallback)
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建数据目录失败：{error}"))?;
    }
    let text =
        serde_json::to_string_pretty(value).map_err(|error| format!("序列化数据失败：{error}"))?;
    fs::write(path, text).map_err(|error| format!("写入数据失败：{error}"))
}

fn normalize_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn safe_filename_part(value: &str, max_len: usize) -> String {
    let mut output = value
        .trim()
        .chars()
        .map(|ch| {
            if matches!(
                ch,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\n' | '\r' | '\t'
            ) {
                '-'
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if output.chars().count() > max_len {
        output = output.chars().take(max_len).collect();
    }
    if output.is_empty() {
        "image".to_string()
    } else {
        output
    }
}

fn parse_data_url(data_url: &str) -> Result<(Vec<u8>, String), String> {
    let (meta, data) = data_url
        .split_once(',')
        .ok_or_else(|| "文件数据格式无效".to_string())?;
    let mime = meta
        .strip_prefix("data:")
        .and_then(|rest| rest.split(';').next())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|error| format!("解析文件数据失败：{error}"))?;
    Ok((bytes, mime))
}

fn image_extension_from_url(url: &str) -> String {
    url.split('?')
        .next()
        .and_then(|clean| clean.rsplit('.').next())
        .filter(|ext| (2..=5).contains(&ext.len()))
        .filter(|ext| ext.chars().all(|ch| ch.is_ascii_alphanumeric()))
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "png".to_string())
}

fn extension_for_item(item: &TaskImageItem) -> String {
    if item.b64_json.is_some() {
        "png".to_string()
    } else {
        item.url
            .as_deref()
            .map(image_extension_from_url)
            .unwrap_or_else(|| "png".to_string())
    }
}

fn is_image_path(path: &Path) -> bool {
    mime_guess::from_path(path)
        .first()
        .map(|mime| mime.type_() == "image")
        .unwrap_or(false)
}

fn image_mime_from_path(path: &Path) -> String {
    mime_guess::from_path(path)
        .first()
        .filter(|mime| mime.type_() == "image")
        .map(|mime| mime.to_string())
        .unwrap_or_else(|| "image/png".to_string())
}

fn image_mime_from_url(url: &str) -> String {
    let extension = image_extension_from_url(url);
    mime_guess::from_ext(&extension)
        .first()
        .filter(|mime| mime.type_() == "image")
        .map(|mime| mime.to_string())
        .unwrap_or_else(|| "image/png".to_string())
}

fn data_url_from_bytes(bytes: &[u8], mime: &str) -> String {
    format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    )
}

fn thumbnail_bytes_from_image_bytes(bytes: &[u8]) -> Option<Vec<u8>> {
    let image = image::load_from_memory(bytes).ok()?;
    let thumbnail = image.thumbnail(640, 640);
    let mut encoded = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut encoded, 78);
    encoder.encode_image(&thumbnail).ok()?;
    Some(encoded)
}

fn thumbnail_path_for_image(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?;
    let filename = path.file_name()?.to_str()?;
    Some(parent.join(".thumbnails").join(format!("{filename}.jpg")))
}

fn ensure_thumbnail_file(path: &Path, bytes: &[u8]) -> Option<PathBuf> {
    let thumbnail_path = thumbnail_path_for_image(path)?;
    if thumbnail_path.exists() {
        return Some(thumbnail_path);
    }
    let thumbnail_bytes = thumbnail_bytes_from_image_bytes(bytes)?;
    if let Some(parent) = thumbnail_path.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    fs::write(&thumbnail_path, thumbnail_bytes).ok()?;
    Some(thumbnail_path)
}

fn is_thumbnail_artifact(path: &Path) -> bool {
    path.components().any(|component| component.as_os_str() == ".thumbnails")
}

fn read_be_u32(bytes: &[u8], start: usize) -> Option<u32> {
    let chunk = bytes.get(start..start + 4)?;
    Some(u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
}

fn read_le_u16(bytes: &[u8], start: usize) -> Option<u16> {
    let chunk = bytes.get(start..start + 2)?;
    Some(u16::from_le_bytes([chunk[0], chunk[1]]))
}

fn read_le_u24_plus_one(bytes: &[u8], start: usize) -> Option<u32> {
    let chunk = bytes.get(start..start + 3)?;
    Some(u32::from(chunk[0]) + (u32::from(chunk[1]) << 8) + (u32::from(chunk[2]) << 16) + 1)
}

fn image_dimensions_from_bytes(bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return (read_be_u32(bytes, 16), read_be_u32(bytes, 20));
    }

    if bytes.starts_with(b"\xff\xd8") {
        let mut offset = 2usize;
        while offset + 9 < bytes.len() {
            if bytes[offset] != 0xff {
                offset += 1;
                continue;
            }
            while offset < bytes.len() && bytes[offset] == 0xff {
                offset += 1;
            }
            let marker = *bytes.get(offset).unwrap_or(&0);
            offset += 1;
            if marker == 0xd8 || marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
                continue;
            }
            let length = match bytes.get(offset..offset + 2) {
                Some(chunk) => u16::from_be_bytes([chunk[0], chunk[1]]) as usize,
                None => break,
            };
            if length < 2 || offset + length > bytes.len() {
                break;
            }
            if matches!(marker, 0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf) {
                let height = bytes.get(offset + 3..offset + 5).map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]) as u32);
                let width = bytes.get(offset + 5..offset + 7).map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]) as u32);
                return (width, height);
            }
            offset += length;
        }
    }

    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
        if bytes.get(12..16) == Some(b"VP8X".as_slice()) {
            return (read_le_u24_plus_one(bytes, 24), read_le_u24_plus_one(bytes, 27));
        }
        if bytes.get(12..16) == Some(b"VP8L".as_slice()) {
            if let Some(chunk) = bytes.get(21..25) {
                let bits = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                return (Some((bits & 0x3fff) + 1), Some(((bits >> 14) & 0x3fff) + 1));
            }
        }
        if bytes.get(12..16) == Some(b"VP8 ".as_slice()) {
            return (
                read_le_u16(bytes, 26).map(|value| u32::from(value & 0x3fff)),
                read_le_u16(bytes, 28).map(|value| u32::from(value & 0x3fff)),
            );
        }
    }

    (None, None)
}

fn image_metadata_path(path: &Path) -> PathBuf {
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    path.with_file_name(format!("{filename}.json"))
}

fn image_metadata_from_path(path: &Path) -> Option<ImageMetadata> {
    fs::read_to_string(image_metadata_path(path))
        .ok()
        .and_then(|text| serde_json::from_str::<ImageMetadata>(&text).ok())
}

fn image_prompt_from_metadata(path: &Path) -> Option<String> {
    image_metadata_from_path(path)
        .map(|metadata| metadata.prompt)
        .filter(|prompt| !prompt.trim().is_empty())
}

fn local_sort_parts(value: &str) -> Option<(i64, i64)> {
    let (batch, rest) = value.split_once('-')?;
    let index = rest.split('-').next().unwrap_or(rest);
    Some((batch.parse().ok()?, index.parse().ok()?))
}

fn compare_local_image_order(
    left_sort_key: &str,
    right_sort_key: &str,
    left_created_at: &str,
    right_created_at: &str,
) -> Ordering {
    match (local_sort_parts(left_sort_key), local_sort_parts(right_sort_key)) {
        (Some((left_batch, left_index)), Some((right_batch, right_index))) => right_batch
            .cmp(&left_batch)
            .then_with(|| right_index.cmp(&left_index)),
        _ => right_created_at.cmp(left_created_at),
    }
}

fn is_result_date_folder(value: &str) -> bool {
    value.len() == 10 && NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn local_result_dates(root: &Path) -> Result<Vec<String>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut dates = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| format!("读取本地结果目录失败：{error}"))? {
        let entry = entry.map_err(|error| format!("读取本地结果目录失败：{error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if is_result_date_folder(name) {
            dates.push(name.to_string());
        }
    }
    dates.sort_by(|left, right| right.cmp(left));
    Ok(dates)
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn canonical_child_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("读取本地结果目录失败：{error}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("读取本地图片路径失败：{error}"))?;
    if canonical_path.starts_with(&canonical_root) {
        Ok(canonical_path)
    } else {
        Err("图片路径不在本地结果目录内".to_string())
    }
}

async fn image_item_bytes(
    client: &Client,
    connection: &Connection,
    item: &TaskImageItem,
) -> Result<Vec<u8>, String> {
    image_item_bytes_with_mime(client, connection, item)
        .await
        .map(|(bytes, _)| bytes)
}

async fn image_item_bytes_with_mime(
    client: &Client,
    connection: &Connection,
    item: &TaskImageItem,
) -> Result<(Vec<u8>, String), String> {
    if let Some(b64) = &item.b64_json {
        return general_purpose::STANDARD
            .decode(b64)
            .map(|bytes| (bytes, "image/png".to_string()))
            .map_err(|error| format!("解析图片结果失败：{error}"));
    }
    let url = item
        .url
        .as_deref()
        .ok_or_else(|| "图片结果没有可保存的内容".to_string())?;
    let mut request = client.get(url);
    if !connection.api_key.trim().is_empty() {
        request = request.bearer_auth(connection.api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("下载图片失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载图片失败 ({})", response.status()));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .map(ToString::to_string)
        .unwrap_or_else(|| image_mime_from_url(url));
    response
        .bytes()
        .await
        .map(|bytes| (bytes.to_vec(), mime))
        .map_err(|error| format!("读取图片内容失败：{error}"))
}

fn parse_api_error_text(text: &str) -> String {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| {
            value
                .get("detail")
                .or_else(|| value.get("error"))
                .or_else(|| value.get("message"))
                .and_then(|item| item.as_str().map(ToString::to_string))
        })
        .unwrap_or_else(|| text.to_string())
}

#[tauri::command]
fn load_connection<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    let path = app_data_dir(&app)?.join(CONNECTION_FILE);
    Ok(read_json_file(
        &path,
        json!({ "baseUrl": FIXED_BASE_URL, "apiKey": "" }),
    ))
}

#[tauri::command]
fn save_connection<R: Runtime>(app: tauri::AppHandle<R>, value: Value) -> Result<(), String> {
    write_json_file(&app_data_dir(&app)?.join(CONNECTION_FILE), &value)
}

#[tauri::command]
fn load_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppSettings, String> {
    let path = app_data_dir(&app)?.join(SETTINGS_FILE);
    Ok(read_json_file(&path, AppSettings { result_dir: None }))
}

#[tauri::command]
fn save_settings<R: Runtime>(app: tauri::AppHandle<R>, value: AppSettings) -> Result<(), String> {
    write_json_file(
        &app_data_dir(&app)?.join(SETTINGS_FILE),
        &serde_json::to_value(value).map_err(|error| error.to_string())?,
    )
}

#[tauri::command]
fn host_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unknown"
    }
}

#[tauri::command]
fn check_result_dir_access(result_dir: String) -> Result<(), String> {
    if result_dir.trim().is_empty() {
        return Err("请先选择本地结果目录".to_string());
    }
    let root = PathBuf::from(result_dir);
    if !root.exists() {
        return Err("本地结果目录不存在".to_string());
    }
    fs::read_dir(&root).map_err(|error| format!("读取本地结果目录失败：{error}"))?;
    let probe = root.join(".phantom_image_client_access_check.tmp");
    fs::write(&probe, b"ok").map_err(|error| format!("写入本地结果目录失败：{error}"))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

#[tauri::command]
async fn read_dropped_images(paths: Vec<String>) -> Result<Vec<UploadedFile>, String> {
    let mut images = Vec::new();
    for raw_path in paths {
        let path = PathBuf::from(raw_path);
        if !path.is_file() || !is_image_path(&path) {
            continue;
        }
        let bytes = async_fs::read(&path)
            .await
            .map_err(|error| format!("读取拖入图片失败：{error}"))?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_string();
        images.push(UploadedFile {
            name,
            data_url: data_url_from_bytes(&bytes, &image_mime_from_path(&path)),
        });
    }
    Ok(images)
}

#[tauri::command]
fn load_tasks<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    let path = app_data_dir(&app)?.join(HISTORY_FILE);
    Ok(read_json_file(&path, json!([])))
}

#[tauri::command]
fn save_tasks<R: Runtime>(app: tauri::AppHandle<R>, tasks: Value) -> Result<(), String> {
    write_json_file(&app_data_dir(&app)?.join(HISTORY_FILE), &tasks)
}

#[tauri::command]
async fn api_request(payload: ApiRequestPayload) -> Result<Value, String> {
    let client = Client::new();
    let base_url = normalize_base_url(&payload.connection.base_url);
    if base_url.is_empty() {
        return Err("固定服务地址不可用".to_string());
    }
    if payload.connection.api_key.trim().is_empty() {
        return Err("请先填写 API Key".to_string());
    }
    let method = payload
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<Method>()
        .map_err(|error| format!("请求方法无效：{error}"))?;
    let url = format!("{base_url}{}", payload.path);
    let mut request = client
        .request(method, &url)
        .bearer_auth(payload.connection.api_key.trim());
    if let Some(body) = payload.body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if content_type.contains("text/html")
        || text.trim_start().starts_with("<!DOCTYPE")
        || text.trim_start().starts_with("<html")
    {
        return Err(format!("接口 {url} 返回了网页 HTML（HTTP {status}，{content_type}）。固定服务地址异常，请检查客户端配置"));
    }
    if !status.is_success() {
        return Err(parse_api_error_text(&text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|error| format!("接口返回的不是合法 JSON：{error}"))
}

#[tauri::command]
async fn api_multipart_request(payload: MultipartRequestPayload) -> Result<Value, String> {
    let client = Client::new();
    let base_url = normalize_base_url(&payload.connection.base_url);
    if base_url.is_empty() {
        return Err("固定服务地址不可用".to_string());
    }
    if payload.connection.api_key.trim().is_empty() {
        return Err("请先填写 API Key".to_string());
    }
    let mut form = multipart::Form::new();
    for (key, value) in payload.fields {
        form = form.text(key, value);
    }
    for file in payload.files {
        let (bytes, mime) = parse_data_url(&file.data_url)?;
        let part = multipart::Part::bytes(bytes)
            .file_name(file.name)
            .mime_str(&mime)
            .map_err(|error| format!("设置文件类型失败：{error}"))?;
        form = form.part("image", part);
    }
    let url = format!("{base_url}{}", payload.path);
    let response = client
        .post(&url)
        .bearer_auth(payload.connection.api_key.trim())
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if content_type.contains("text/html")
        || text.trim_start().starts_with("<!DOCTYPE")
        || text.trim_start().starts_with("<html")
    {
        return Err(format!("接口 {url} 返回了网页 HTML（HTTP {status}，{content_type}）。固定服务地址异常，请检查客户端配置"));
    }
    if !status.is_success() {
        return Err(parse_api_error_text(&text));
    }
    serde_json::from_str(&text).map_err(|error| format!("接口返回的不是合法 JSON：{error}"))
}

#[tauri::command]
async fn save_task_images(payload: SaveTaskImagesPayload) -> Result<Vec<String>, String> {
    if payload.result_dir.trim().is_empty() {
        return Err("请先选择本地结果目录".to_string());
    }
    if payload.data.is_empty() {
        return Ok(vec![]);
    }
    let client = Client::new();
    let folder_name = Local::now().format("%Y-%m-%d").to_string();
    let day_dir = PathBuf::from(&payload.result_dir).join(&folder_name);
    async_fs::create_dir_all(&day_dir)
        .await
        .map_err(|error| format!("创建本地结果目录失败：{error}"))?;
    let mut saved = Vec::new();
    for (index, item) in payload.data.iter().enumerate() {
        let bytes = image_item_bytes(&client, &payload.connection, item).await?;
        let extension = safe_filename_part(&extension_for_item(item), 5);
        let task_code = safe_filename_part(&payload.task_id, 12);
        let prefix = format!(
            "{}-{}-{}",
            safe_filename_part(&payload.local_created_at, 40),
            safe_filename_part(&payload.prompt, 20),
            task_code
        );
        let filename = format!("{prefix}-{}.{}", index + 1, extension);
        let path = day_dir.join(&filename);
        let mut file = async_fs::File::create(&path)
            .await
            .map_err(|error| format!("创建图片文件失败：{error}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|error| format!("写入图片文件失败：{error}"))?;
        let _ = ensure_thumbnail_file(&path, &bytes);
        let metadata = ImageMetadata {
            task_id: payload.task_id.clone(),
            prompt: payload.prompt.clone(),
            local_created_at: payload.local_created_at.clone(),
            local_sort_key: payload.local_sort_key.clone(),
        };
        let metadata_text = serde_json::to_string_pretty(&metadata)
            .map_err(|error| format!("序列化图片提示词失败：{error}"))?;
        async_fs::write(image_metadata_path(&path), metadata_text)
            .await
            .map_err(|error| format!("写入图片提示词失败：{error}"))?;
        saved.push(format!("{folder_name}/{filename}"));
    }
    Ok(saved)
}

#[tauri::command]
async fn hydrate_task_images(
    payload: HydrateTaskImagesPayload,
) -> Result<Vec<TaskImageItem>, String> {
    let client = Client::new();
    let mut hydrated = Vec::new();
    for item in payload.data {
        if item.b64_json.is_some() {
            hydrated.push(item);
            continue;
        }
        let (bytes, _mime) =
            image_item_bytes_with_mime(&client, &payload.connection, &item).await?;
        hydrated.push(TaskImageItem {
            b64_json: Some(general_purpose::STANDARD.encode(bytes)),
            url: item.url,
        });
    }
    Ok(hydrated)
}

#[tauri::command]
fn scan_local_images(
    result_dir: String,
    date: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<LocalImagePage, String> {
    let current_page = page.unwrap_or(1).max(1);
    let current_page_size = page_size.unwrap_or(24).clamp(6, 96);
    if result_dir.trim().is_empty() {
        return Ok(LocalImagePage {
            items: vec![],
            total: 0,
            page: current_page,
            page_size: current_page_size,
            dates: vec![],
        });
    }
    let root = PathBuf::from(result_dir);
    if !root.exists() {
        return Err("本地结果目录不存在".to_string());
    }
    let dates = local_result_dates(&root)?;
    let selected_date = date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    if !is_result_date_folder(&selected_date) {
        return Err("本地结果日期无效".to_string());
    }

    let scan_root = root.join(&selected_date);
    if !scan_root.exists() {
        return Ok(LocalImagePage {
            items: vec![],
            total: 0,
            page: current_page,
            page_size: current_page_size,
            dates,
        });
    }

    let mut image_paths = Vec::new();
    for entry in WalkDir::new(&scan_root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || is_thumbnail_artifact(path) || !is_image_path(path) {
            continue;
        }
        let metadata = fs::metadata(path).map_err(|error| format!("读取图片信息失败：{error}"))?;
        let modified = metadata.modified().ok();
        let created_at = modified
            .map(|time| DateTime::<Local>::from(time).to_rfc3339())
            .unwrap_or_else(|| Local::now().to_rfc3339());
        let local_sort_key = image_metadata_from_path(path)
            .and_then(|metadata| metadata.local_sort_key)
            .unwrap_or_else(|| created_at.clone());
        image_paths.push((path.to_path_buf(), metadata.len(), created_at, modified, local_sort_key));
    }
    image_paths.sort_by(|left, right| {
        compare_local_image_order(&left.4, &right.4, &left.2, &right.2)
            .then_with(|| right.0.cmp(&left.0))
    });
    let total = image_paths.len();
    let total_pages = if total == 0 {
        1
    } else {
        total.div_ceil(current_page_size)
    };
    let effective_page = current_page.min(total_pages);
    let offset = (effective_page - 1).saturating_mul(current_page_size);
    let mut items = Vec::new();
    for (path, size, created_at, modified, _) in image_paths
        .into_iter()
        .skip(offset)
        .take(current_page_size)
    {
        let local_created_at = modified
            .map(|time| {
                DateTime::<Local>::from(time)
                    .format("%Y/%m/%d %H:%M:%S")
                    .to_string()
            })
            .unwrap_or_else(|| Local::now().format("%Y/%m/%d %H:%M:%S").to_string());
        let rel = rel_path(&root, &path);
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_string();
        let bytes = fs::read(&path).map_err(|error| format!("读取本地图片失败：{error}"))?;
        let (width, height) = image_dimensions_from_bytes(&bytes);
        let thumbnail_path = ensure_thumbnail_file(&path, &bytes)
            .map(|value| value.to_string_lossy().to_string());
        let prompt = image_prompt_from_metadata(&path);
        items.push(LocalImage {
            id: format!("local:{rel}"),
            rel,
            name,
            path: path.to_string_lossy().to_string(),
            thumbnail_path,
            prompt,
            created_at,
            local_created_at,
            size,
            width,
            height,
        });
    }
    Ok(LocalImagePage {
        items,
        total,
        page: effective_page,
        page_size: current_page_size,
        dates,
    })
}

#[tauri::command]
fn delete_local_images(result_dir: String, paths: Vec<String>) -> Result<usize, String> {
    if result_dir.trim().is_empty() {
        return Err("请先选择本地结果目录".to_string());
    }
    let root = PathBuf::from(result_dir);
    if !root.exists() {
        return Err("本地结果目录不存在".to_string());
    }
    let mut removed = 0;
    for path in paths {
        let input_path = PathBuf::from(path);
        let path = if input_path.is_absolute() {
            input_path
        } else {
            root.join(input_path)
        };
        if path.exists() {
            let target = canonical_child_path(&root, &path)?;
            fs::remove_file(&target).map_err(|error| format!("删除本地图片失败：{error}"))?;
            let metadata_path = image_metadata_path(&target);
            if metadata_path.exists() {
                let _ = fs::remove_file(metadata_path);
            }
            if let Some(thumbnail_path) = thumbnail_path_for_image(&target) {
                if thumbnail_path.exists() {
                    let _ = fs::remove_file(thumbnail_path);
                }
            }
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_connection,
            save_connection,
            load_settings,
            save_settings,
            host_platform,
            check_result_dir_access,
            read_dropped_images,
            load_tasks,
            save_tasks,
            api_request,
            api_multipart_request,
            save_task_images,
            hydrate_task_images,
            scan_local_images,
            delete_local_images,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
