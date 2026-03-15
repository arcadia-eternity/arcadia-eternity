use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use warp::Filter;



// 全局状态来存储服务器端口
#[derive(Default)]
struct ServerState {
    port: Arc<Mutex<Option<u16>>>,
}

// Tauri 命令：获取本地服务器端口
#[tauri::command]
fn get_local_server_port(state: State<ServerState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

// Tauri 命令：下载SWF文件到本地缓存
#[tauri::command]
async fn download_pet_swf(app_handle: tauri::AppHandle, pet_num: u32, remote_url: String) -> Result<String, String> {
    use tauri::Manager;

    // 获取应用数据目录
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    let cache_dir = app_data_dir.join("pets");

    // 确保缓存目录存在
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        return Err(format!("创建缓存目录失败: {}", e));
    }

    let local_path = cache_dir.join(format!("{}.swf", pet_num));

    // 如果文件已存在，直接返回成功
    if local_path.exists() {
        return Ok(format!("文件已存在: {:?}", local_path));
    }

    // 下载文件
    log::info!("开始下载 Pet {} 从 {}", pet_num, remote_url);

    let response = reqwest::get(&remote_url).await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败，HTTP状态码: {}", response.status()));
    }

    let bytes = response.bytes().await
        .map_err(|e| format!("读取响应数据失败: {}", e))?;

    // 保存文件
    tokio::fs::write(&local_path, &bytes).await
        .map_err(|e| format!("保存文件失败: {}", e))?;

    log::info!("Pet {} 下载完成，保存到: {:?}", pet_num, local_path);
    Ok(format!("下载完成: {:?}", local_path))
}

// 查找可用端口
fn find_available_port() -> Option<u16> {
    use std::net::{SocketAddr, TcpListener};

    // 尝试从 8103 开始的端口范围
    for port in 8103..8200 {
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().ok()?;
        if TcpListener::bind(addr).is_ok() {
            return Some(port);
        }
    }
    None
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StringOrArray {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePackSummary {
    folder_name: String,
    id: String,
    version: String,
    manifest_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackTemplateSummary {
    id: String,
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePackFromTemplateInput {
    folder_name: String,
    pack_id: Option<String>,
    version: Option<String>,
    template: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatePackFromTemplateResult {
    folder_name: String,
    pack_id: String,
    version: String,
    pack_path: String,
    created_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestPaths {
    #[serde(default, rename = "dataDir")]
    data_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestData {
    #[serde(default)]
    effects: Vec<String>,
    #[serde(default)]
    marks: Vec<String>,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default)]
    species: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PackManifestForWorkspace {
    id: String,
    #[serde(default = "default_pack_version")]
    version: String,
    #[serde(default)]
    paths: Option<ManifestPaths>,
    data: ManifestData,
    #[serde(default, rename = "assetsRef")]
    assets_ref: Option<StringOrArray>,
}

fn default_pack_version() -> String {
    "1.0.0".to_string()
}

#[derive(Debug, Serialize)]
struct WorkspaceManifestPaths {
    #[serde(rename = "dataDir")]
    data_dir: String,
    #[serde(rename = "localesDir")]
    locales_dir: String,
}

#[derive(Debug, Serialize)]
struct WorkspaceManifestData {
    effects: Vec<String>,
    marks: Vec<String>,
    skills: Vec<String>,
    species: Vec<String>,
}

#[derive(Debug, Serialize)]
struct WorkspaceManifest {
    id: String,
    version: String,
    engine: String,
    #[serde(rename = "layoutVersion")]
    layout_version: u8,
    paths: WorkspaceManifestPaths,
    data: WorkspaceManifestData,
    #[serde(rename = "assetsRef", skip_serializing_if = "Option::is_none")]
    assets_ref: Option<Vec<String>>,
}

#[derive(Debug)]
struct DiscoveredPack {
    folder_name: String,
    manifest: PackManifestForWorkspace,
}

fn sanitize_folder_name(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "." || trimmed == ".." {
        return None;
    }
    let normalized = trimmed.to_ascii_lowercase();
    if normalized
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Some(normalized)
    } else {
        None
    }
}

fn is_valid_pack_id(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.split('.').all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    })
}

fn is_valid_semver_like(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }
    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn has_traversal_segment(tail: &str) -> bool {
    tail.split('/').any(|segment| segment == "..")
}

fn normalize_path_join(base: &str, child: &str) -> String {
    let base_clean = base.trim_matches('/');
    let child_clean = child.trim_matches('/');
    if base_clean.is_empty() {
        child_clean.to_string()
    } else if child_clean.is_empty() {
        base_clean.to_string()
    } else {
        format!("{}/{}", base_clean, child_clean)
    }
}

fn to_workspace_file_url(port: u16, folder: &str, relative_path: &str) -> String {
    let cleaned = relative_path.trim_start_matches('/');
    format!("http://127.0.0.1:{}/packs/{}/{}", port, folder, cleaned)
}

fn is_protocol_url(value: &str) -> bool {
    value.contains("://")
}

fn list_assets_refs(pack_root: &PathBuf, assets_ref: &str) -> Vec<String> {
    if is_protocol_url(assets_ref) {
        return vec![assets_ref.to_string()];
    }

    let candidate = pack_root.join(assets_ref);
    match std::fs::metadata(&candidate) {
        Ok(metadata) if metadata.is_dir() => {
            let mut json_files: Vec<String> = vec![];
            if let Ok(entries) = std::fs::read_dir(&candidate) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if ext.eq_ignore_ascii_case("json") {
                                if let Ok(relative) = path.strip_prefix(pack_root) {
                                    if let Some(value) = relative.to_str() {
                                        json_files.push(value.replace('\\', "/"));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if json_files.is_empty() {
                vec![normalize_path_join(assets_ref, "assets.json")]
            } else {
                json_files.sort_by(|a, b| {
                    let a_default = a.to_lowercase().ends_with("/assets.json") || a.eq_ignore_ascii_case("assets.json");
                    let b_default = b.to_lowercase().ends_with("/assets.json") || b.eq_ignore_ascii_case("assets.json");
                    if a_default && !b_default {
                        std::cmp::Ordering::Less
                    } else if !a_default && b_default {
                        std::cmp::Ordering::Greater
                    } else {
                        a.cmp(b)
                    }
                });
                json_files
            }
        }
        _ => {
            if assets_ref.to_lowercase().ends_with(".json") {
                vec![assets_ref.to_string()]
            } else {
                vec![normalize_path_join(assets_ref, "assets.json")]
            }
        }
    }
}

fn detect_content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "mp3" => "audio/mpeg",
        "swf" => "application/x-shockwave-flash",
        _ => "application/octet-stream",
    }
}

fn discover_workspace_packs(packs_dir: &PathBuf) -> Vec<DiscoveredPack> {
    let mut discovered: Vec<DiscoveredPack> = vec![];
    let entries = match std::fs::read_dir(packs_dir) {
        Ok(entries) => entries,
        Err(_) => return discovered,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = match path.file_name().and_then(|v| v.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        let manifest_path = path.join("pack.json");
        if !manifest_path.exists() {
            continue;
        }
        let raw = match std::fs::read_to_string(&manifest_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let manifest = match serde_json::from_str::<PackManifestForWorkspace>(&raw) {
            Ok(manifest) => manifest,
            Err(_) => continue,
        };
        discovered.push(DiscoveredPack { folder_name, manifest });
    }

    discovered.sort_by(|a, b| {
        let a_is_base = a.manifest.id == "arcadia-eternity.base";
        let b_is_base = b.manifest.id == "arcadia-eternity.base";
        if a_is_base && !b_is_base {
            std::cmp::Ordering::Less
        } else if !a_is_base && b_is_base {
            std::cmp::Ordering::Greater
        } else {
            a.manifest.id.cmp(&b.manifest.id)
        }
    });

    discovered
}

fn build_workspace_manifest(port: u16, packs_dir: &PathBuf) -> Option<WorkspaceManifest> {
    let discovered = discover_workspace_packs(packs_dir);
    if discovered.is_empty() {
        return None;
    }
    if !discovered.iter().any(|item| item.manifest.id == "arcadia-eternity.base") {
        return None;
    }

    let mut data_effects: Vec<String> = vec![];
    let mut data_marks: Vec<String> = vec![];
    let mut data_skills: Vec<String> = vec![];
    let mut data_species: Vec<String> = vec![];
    let mut assets_refs: Vec<String> = vec![];

    for pack in discovered {
        let data_dir = pack
            .manifest
            .paths
            .as_ref()
            .and_then(|p| p.data_dir.clone())
            .unwrap_or_else(|| ".".to_string());

        for file in pack.manifest.data.effects {
            let relative = normalize_path_join(&data_dir, &file);
            data_effects.push(to_workspace_file_url(port, &pack.folder_name, &relative));
        }
        for file in pack.manifest.data.marks {
            let relative = normalize_path_join(&data_dir, &file);
            data_marks.push(to_workspace_file_url(port, &pack.folder_name, &relative));
        }
        for file in pack.manifest.data.skills {
            let relative = normalize_path_join(&data_dir, &file);
            data_skills.push(to_workspace_file_url(port, &pack.folder_name, &relative));
        }
        for file in pack.manifest.data.species {
            let relative = normalize_path_join(&data_dir, &file);
            data_species.push(to_workspace_file_url(port, &pack.folder_name, &relative));
        }

        let pack_root = packs_dir.join(&pack.folder_name);
        let refs = match pack.manifest.assets_ref {
            Some(StringOrArray::Single(value)) => vec![value],
            Some(StringOrArray::Multiple(values)) => values,
            None => vec![],
        };
        for asset_ref in refs {
            for entry in list_assets_refs(&pack_root, &asset_ref) {
                if is_protocol_url(&entry) {
                    assets_refs.push(entry);
                } else {
                    assets_refs.push(to_workspace_file_url(port, &pack.folder_name, &entry));
                }
            }
        }
    }

    Some(WorkspaceManifest {
        id: "arcadia-eternity.workspace".to_string(),
        version: "1.0.0".to_string(),
        engine: "seer2-v2".to_string(),
        layout_version: 1,
        paths: WorkspaceManifestPaths {
            data_dir: ".".to_string(),
            locales_dir: ".".to_string(),
        },
        data: WorkspaceManifestData {
            effects: data_effects,
            marks: data_marks,
            skills: data_skills,
            species: data_species,
        },
        assets_ref: if assets_refs.is_empty() { None } else { Some(assets_refs) },
    })
}

fn build_workspace_index(packs_dir: &PathBuf) -> Vec<WorkspacePackSummary> {
    discover_workspace_packs(packs_dir)
        .into_iter()
        .map(|item| WorkspacePackSummary {
            folder_name: item.folder_name.clone(),
            id: item.manifest.id,
            version: item.manifest.version,
            manifest_path: format!("{}/pack.json", item.folder_name),
        })
        .collect()
}

fn starter_template_files(pack_id: &str, version: &str) -> Result<Vec<(String, String)>, String> {
    let pack_json = serde_json::to_string_pretty(&serde_json::json!({
        "id": pack_id,
        "version": version,
        "engine": "seer2-v2",
        "layoutVersion": 1,
        "assetsRef": "assets",
        "paths": {
            "dataDir": "data",
            "localesDir": "locales"
        },
        "data": {
            "effects": ["effect.yaml"],
            "marks": ["mark.yaml"],
            "skills": ["skill.yaml"],
            "species": ["species.yaml"]
        },
        "locales": {
            "zh-CN": ["mark", "skill", "species", "webui", "battle"]
        }
    }))
    .map_err(|e| format!("生成 pack.json 失败: {}", e))?;

    let assets_json = serde_json::to_string_pretty(&serde_json::json!({
        "id": format!("{}.assets", pack_id),
        "version": version,
        "engine": "seer2-v2",
        "assets": [],
        "mappings": {
            "species": {},
            "marks": {},
            "skills": {}
        }
    }))
    .map_err(|e| format!("生成 assets.json 失败: {}", e))?;

    Ok(vec![
        ("pack.json".to_string(), pack_json),
        ("assets/assets.json".to_string(), assets_json),
        (
            "data/effect.yaml".to_string(),
            "- id: effect_template_power_up\n  trigger: OnDamage\n  priority: 0\n  apply:\n    type: addPower\n    target: useSkillContext\n    value: 10\n".to_string(),
        ),
        (
            "data/mark.yaml".to_string(),
            "- id: mark_template\n  effect:\n    - effect_template_power_up\n".to_string(),
        ),
        (
            "data/skill.yaml".to_string(),
            "- id: skill_template\n  element: Normal\n  category: Physical\n  target: opponent\n  power: 60\n  rage: 0\n  accuracy: 100\n  effect:\n    - effect_template_power_up\n".to_string(),
        ),
        (
            "data/species.yaml".to_string(),
            "- id: pet_template\n  num: 900001\n  element: Normal\n  baseStats:\n    hp: 100\n    atk: 100\n    def: 100\n    spa: 100\n    spd: 100\n    spe: 100\n  genderRatio: [50, 50]\n  heightRange: [10, 20]\n  weightRange: [10, 20]\n  ability: []\n  emblem: []\n  learnable_skills:\n    - level: 1\n      skill_id: skill_template\n      hidden: false\n".to_string(),
        ),
        (
            "locales/zh-CN/mark.yaml".to_string(),
            "mark_template:\n  name: 模板印记\n".to_string(),
        ),
        (
            "locales/zh-CN/skill.yaml".to_string(),
            "skill_template:\n  name: 模板技能\n".to_string(),
        ),
        (
            "locales/zh-CN/species.yaml".to_string(),
            "pet_template:\n  name: 模板精灵\n".to_string(),
        ),
        (
            "locales/zh-CN/webui.yaml".to_string(),
            "pack_template:\n  name: 模板数据包\n".to_string(),
        ),
        (
            "locales/zh-CN/battle.yaml".to_string(),
            "template_message: 模板数据包已加载\n".to_string(),
        ),
        (
            "README.md".to_string(),
            "# Starter Pack\n\n此目录由内置模板生成，可直接在编辑器中按数据包维度进行修改。\n".to_string(),
        ),
    ])
}

#[tauri::command]
fn list_pack_templates() -> Vec<PackTemplateSummary> {
    vec![PackTemplateSummary {
        id: "starter".to_string(),
        name: "Starter Pack".to_string(),
        description: "基础可运行模板，包含最小的 effect/mark/skill/species 与 locales 结构".to_string(),
    }]
}

#[tauri::command]
fn list_workspace_packs(app_handle: tauri::AppHandle) -> Result<Vec<WorkspacePackSummary>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let packs_dir = app_data_dir.join("packs");
    std::fs::create_dir_all(&packs_dir).map_err(|e| format!("无法创建 packs 目录: {}", e))?;
    Ok(build_workspace_index(&packs_dir))
}

#[tauri::command]
async fn create_pack_from_template(
    app_handle: tauri::AppHandle,
    input: CreatePackFromTemplateInput,
) -> Result<CreatePackFromTemplateResult, String> {
    let template_id = input.template.unwrap_or_else(|| "starter".to_string());
    if template_id != "starter" {
        return Err(format!("不支持的模板: {}", template_id));
    }

    let folder_name = sanitize_folder_name(&input.folder_name)
        .ok_or_else(|| "folderName 仅允许字母、数字、-、_，且不能为空".to_string())?;

    let pack_id = input
        .pack_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("user.{}", folder_name.replace('-', "_")));
    if !is_valid_pack_id(&pack_id) {
        return Err("packId 格式非法，建议使用 a.b.c 形式，且每段仅允许字母/数字/-/_".to_string());
    }

    let version = input
        .version
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "0.1.0".to_string());
    if !is_valid_semver_like(&version) {
        return Err("version 必须是 x.y.z 数字格式".to_string());
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    let packs_dir = app_data_dir.join("packs");
    tokio::fs::create_dir_all(&packs_dir)
        .await
        .map_err(|e| format!("创建 packs 目录失败: {}", e))?;

    let target_dir = packs_dir.join(&folder_name);
    if target_dir.exists() {
        return Err(format!("数据包目录已存在: {}", folder_name));
    }
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("创建数据包目录失败: {}", e))?;

    let files = starter_template_files(&pack_id, &version)?;
    let mut created_files: Vec<String> = vec![];
    for (relative_path, content) in files {
        let full_path = target_dir.join(&relative_path);
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建目录失败({}): {}", relative_path, e))?;
        }
        tokio::fs::write(&full_path, content.as_bytes())
            .await
            .map_err(|e| format!("写入文件失败({}): {}", relative_path, e))?;
        created_files.push(relative_path);
    }

    Ok(CreatePackFromTemplateResult {
        folder_name: folder_name.clone(),
        pack_id,
        version,
        pack_path: target_dir.to_string_lossy().to_string(),
        created_files,
    })
}

// 下载文件到缓存的辅助函数
async fn download_file_to_cache(url: &str, file_path: &std::path::Path) -> Result<(), String> {
    let response = reqwest::get(url).await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP错误: {}", response.status()));
    }

    let bytes = response.bytes().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    tokio::fs::write(file_path, &bytes).await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    log::info!("文件下载完成: {:?}", file_path);
    Ok(())
}

async fn start_local_server(
    cache_dir: PathBuf,
    packs_dir: PathBuf,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let cache_route = warp::path("cache")
        .and(warp::path("pets"))
        .and(warp::path::tail())
        .and_then(move |tail: warp::path::Tail| {
            let cache_dir = cache_dir.clone();
            async move {
                let file_path = cache_dir.join(tail.as_str());
                if file_path.exists() && file_path.is_file() {
                    Ok(warp::reply::with_header(
                        tokio::fs::read(file_path)
                            .await
                            .map_err(|_| warp::reject::not_found())?,
                        "content-type",
                        "application/x-shockwave-flash",
                    ))
                } else {
                    // 文件不存在时，尝试下载
                    if let Some(file_name) = file_path.file_name().and_then(|n| n.to_str()) {
                        if let Some(pet_num_str) = file_name.strip_suffix(".swf") {
                            if let Ok(pet_num) = pet_num_str.parse::<u32>() {
                                let remote_url = format!("https://seer2-pet-resource.yuuinih.com/public/fight/{}.swf", pet_num);

                                log::info!("文件不存在，尝试下载: {} -> {:?}", remote_url, file_path);

                                match download_file_to_cache(&remote_url, &file_path).await {
                                    Ok(_) => {
                                        // 下载成功，重新读取文件
                                        match tokio::fs::read(&file_path).await {
                                            Ok(content) => {
                                                return Ok(warp::reply::with_header(
                                                    content,
                                                    "content-type",
                                                    "application/x-shockwave-flash",
                                                ));
                                            }
                                            Err(e) => {
                                                log::error!("读取下载的文件失败: {}", e);
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        log::error!("下载文件失败: {}", e);
                                    }
                                }
                            }
                        }
                    }
                    Err(warp::reject::not_found())
                }
            }
        });

    let packs_dir_for_workspace = packs_dir.clone();
    let workspace_manifest_route = warp::path("packs")
        .and(warp::path("workspace"))
        .and(warp::path("pack.json"))
        .and(warp::path::end())
        .map(move || {
            let payload = build_workspace_manifest(port, &packs_dir_for_workspace);
            match payload {
                Some(manifest) => warp::reply::with_status(
                    warp::reply::json(&manifest),
                    warp::http::StatusCode::OK,
                ),
                None => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({
                        "error": "workspace pack not ready"
                    })),
                    warp::http::StatusCode::NOT_FOUND,
                ),
            }
        });

    let packs_dir_for_index = packs_dir.clone();
    let workspace_index_route = warp::path("packs")
        .and(warp::path("workspace"))
        .and(warp::path("index.json"))
        .and(warp::path::end())
        .map(move || {
            let summary = build_workspace_index(&packs_dir_for_index);
            warp::reply::json(&summary)
        });

    let packs_dir_for_files = packs_dir.clone();
    let packs_route = warp::path("packs")
        .and(warp::path::tail())
        .and_then(move |tail: warp::path::Tail| {
            let packs_dir = packs_dir_for_files.clone();
            async move {
                let tail_path = tail.as_str().to_string();
                if tail_path.is_empty() || has_traversal_segment(&tail_path) {
                    return Err(warp::reject::not_found());
                }
                let target = packs_dir.join(&tail_path);
                if !target.exists() || !target.is_file() {
                    return Err(warp::reject::not_found());
                }
                let bytes = tokio::fs::read(&target)
                    .await
                    .map_err(|_| warp::reject::not_found())?;
                let content_type = detect_content_type(&target);
                Ok(warp::reply::with_header(bytes, "content-type", content_type))
            }
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(vec!["GET"]);

    let routes = workspace_manifest_route
        .or(workspace_index_route)
        .or(packs_route)
        .or(cache_route)
        .with(cors);

    log::info!("启动本地缓存服务器: http://localhost:{}", port);
    warp::serve(routes).run(([127, 0, 0, 1], port)).await;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![
            get_local_server_port,
            download_pet_swf,
            list_pack_templates,
            list_workspace_packs,
            create_pack_from_template
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 启动本地 HTTP 服务器来提供缓存文件
            let app_handle = app.handle().clone();
            let server_state = app.state::<ServerState>();
            let port_arc = server_state.port.clone();

            tauri::async_runtime::spawn(async move {
                if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
                    let cache_dir = app_data_dir.join("pets");
                    let packs_dir = app_data_dir.join("packs");
                    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
                        log::error!("创建缓存目录失败: {}", e);
                        return;
                    }
                    if let Err(e) = std::fs::create_dir_all(&packs_dir) {
                        log::error!("创建 packs 目录失败: {}", e);
                        return;
                    }

                    // 查找可用端口
                    if let Some(port) = find_available_port() {
                        // 保存端口到全局状态
                        *port_arc.lock().unwrap() = Some(port);

                        // 启动服务器
                        if let Err(e) = start_local_server(cache_dir, packs_dir, port).await {
                            log::error!("启动本地服务器失败: {}", e);
                        }
                    } else {
                        log::error!("无法找到可用端口");
                    }
                } else {
                    log::error!("无法获取应用数据目录");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
