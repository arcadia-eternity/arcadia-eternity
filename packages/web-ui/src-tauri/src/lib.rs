use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
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

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(vec!["GET"]);

    let routes = cache_route.with(cors);

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
            download_pet_swf
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
                    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
                        log::error!("创建缓存目录失败: {}", e);
                        return;
                    }

                    // 查找可用端口
                    if let Some(port) = find_available_port() {
                        // 保存端口到全局状态
                        *port_arc.lock().unwrap() = Some(port);

                        // 启动服务器
                        if let Err(e) = start_local_server(cache_dir, port).await {
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
