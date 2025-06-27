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

        .plugin(tauri_plugin_process::init())
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![
            get_local_server_port
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
