use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

use crate::forward::{ForwardManager, PortForwardRule};
use crate::keychain;
use crate::monitor::spawn_monitor;
use crate::state::{AppState, TrafficStats};

// ==================== ТИПЫ ====================

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub address: String,
    pub mode: String,
    #[serde(default)]
    pub extra_args: Vec<String>,
    #[serde(default)]
    pub last_used: Option<u64>,
    #[serde(default)]
    pub is_server: bool,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub use_keychain: bool,
    #[serde(default)]
    pub is_exit_node: bool,
}

#[derive(Serialize)]
pub struct TailcatStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

// ==================== УТИЛИТЫ ====================

fn find_tailcat() -> Option<PathBuf> {
    if let Ok(out) = Command::new("which").arg("tailcat").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    [
        "/opt/homebrew/bin/tailcat".to_string(),
        "/usr/local/bin/tailcat".to_string(),
        "/usr/bin/tailcat".to_string(),
        format!("{home}/go/bin/tailcat"),
        format!("{home}/.local/bin/tailcat"),
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|p| p.exists())
}

fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    format!("/opt/homebrew/bin:/usr/local/bin:{home}/go/bin:{home}/.local/bin:{current}")
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

// ==================== TAILCAT STATUS ====================

#[tauri::command]
pub fn check_tailcat() -> TailcatStatus {
    match find_tailcat() {
        Some(path) => {
            let version = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .map(|o| {
                    let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if out.is_empty() {
                        String::from_utf8_lossy(&o.stderr).trim().to_string()
                    } else {
                        out
                    }
                })
                .filter(|s| !s.is_empty());
            TailcatStatus {
                installed: true,
                version,
                path: Some(path.to_string_lossy().to_string()),
            }
        }
        None => TailcatStatus {
            installed: false,
            version: None,
            path: None,
        },
    }
}

// ==================== КОНФИГ / CONNECTIONS ====================

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

fn read_connections(app: &AppHandle) -> Vec<Connection> {
    let Ok(path) = config_file(app) else { return vec![] };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_connections(app: &AppHandle, list: &[Connection]) -> Result<(), String> {
    let path = config_file(app)?;
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_connections(app: AppHandle) -> Vec<Connection> {
    let mut list = read_connections(&app);
    for c in list.iter_mut() {
        if c.use_keychain && c.address.is_empty() {
            if let Some(addr) = keychain::load_address(&c.id) {
                c.address = addr;
            }
        }
    }
    list
}

#[tauri::command]
pub fn save_connection(app: AppHandle, connection: Connection) -> Result<(), String> {
    let address_for_json = if connection.use_keychain {
        keychain::store_address(&connection.id, &connection.address)?;
        String::new()
    } else {
        connection.address.clone()
    };

    let mut list = read_connections(&app);
    let mut stored = connection.clone();
    stored.address = address_for_json;

    if let Some(existing) = list.iter_mut().find(|c| c.id == stored.id) {
        *existing = stored;
    } else {
        list.push(stored);
    }
    write_connections(&app, &list)?;

    if let Some(state) = app.try_state::<AppState>() {
        let mut autostart = state.autostart.lock().unwrap();
        if connection.is_server && connection.autostart {
            autostart.insert(connection.id.clone(), true);
        } else {
            autostart.remove(&connection.id);
        }
    }

    if connection.is_server && connection.autostart {
        let args = vec!["serve".to_string(), connection.address.clone()];
        let _ = run_tailcat(app.clone(), app.state::<AppState>(), connection.id.clone(), args);
    }

    Ok(())
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, id: String) -> Result<(), String> {
    let _ = keychain::delete_address(&id);
    let mut list = read_connections(&app);
    list.retain(|c| c.id != id);
    write_connections(&app, &list)?;

    if let Some(state) = app.try_state::<AppState>() {
        state.autostart.lock().unwrap().remove(&id);
        if let Some(pid) = state.processes.lock().unwrap().remove(&id) {
            kill_pid(pid);
        }
    }
    Ok(())
}

// ==================== ЗАПУСК TAILCAT ====================

#[tauri::command]
pub fn run_tailcat(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    args: Vec<String>,
) -> Result<(), String> {
    {
        let mut procs = state.processes.lock().unwrap();
        if let Some(pid) = procs.remove(&id) {
            kill_pid(pid);
        }
    }

    let bin = find_tailcat().ok_or_else(|| "tailcat не найден в системе".to_string())?;

    let mut child = Command::new(&bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .env("PATH", augmented_path())
        .spawn()
        .map_err(|e| format!("Не удалось запустить tailcat: {e}"))?;

    let pid = child.id();

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit(
                    "tailcat-output",
                    serde_json::json!({ "id": id, "stream": "stdout", "line": line }),
                );
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit(
                    "tailcat-output",
                    serde_json::json!({ "id": id, "stream": "stderr", "line": line }),
                );
            }
        });
    }

    state.processes.lock().unwrap().insert(id.clone(), pid);

    let app_done = app.clone();
    let id_done = id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let code = status.ok().and_then(|s| s.code());
        let _ = app_done.emit(
            "tailcat-exit",
            serde_json::json!({ "id": id_done, "code": code }),
        );
        if code != Some(0) {
            let _ = app_done
                .notification()
                .builder()
                .title("Tailcat")
                .body(format!(
                    "Процесс {} завершился с кодом {}",
                    id_done,
                    code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())
                ))
                .show();
        }
        if let Some(state) = app_done.try_state::<AppState>() {
            state.processes.lock().unwrap().remove(&id_done);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_process(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(pid) = state.processes.lock().unwrap().remove(&id) {
        kill_pid(pid);
    }
    Ok(())
}

// ==================== TERMINAL / FILES ====================

#[tauri::command]
pub fn open_in_terminal(args: Vec<String>) -> Result<(), String> {
    let bin = find_tailcat()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "tailcat".to_string());

    let cmd = format!("{} {}", bin, args.join(" "));
    let escaped = cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell"
    );

    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map_err(|e| format!("Не удалось открыть Terminal: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn send_files(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    address: String,
    files: Vec<String>,
) -> Result<(), String> {
    if files.is_empty() {
        return Err("Не выбрано ни одного файла".into());
    }
    let mut args = vec!["cp".to_string()];
    args.extend(files.clone());
    args.push(address);
    run_tailcat(app, state, id, args)
}

#[tauri::command]
pub async fn pick_and_send_files(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    address: String,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Выберите файлы для отправки")
        .pick_files(move |paths| {
            let _ = tx.send(paths);
        });

    let paths = rx
        .recv()
        .map_err(|_| "Диалог отменён".to_string())?
        .ok_or_else(|| "Файлы не выбраны".to_string())?;

    let files: Vec<String> = paths.into_iter().map(|p| p.to_string()).collect();
    send_files(app, state, id, address, files)
}

#[tauri::command]
pub fn register_dropped_files(
    state: State<'_, AppState>,
    id: String,
    files: Vec<String>,
) -> Result<(), String> {
    state.pending_files.lock().unwrap().insert(id, files);
    Ok(())
}

#[tauri::command]
pub fn take_dropped_files(state: State<'_, AppState>, id: String) -> Vec<String> {
    state
        .pending_files
        .lock()
        .unwrap()
        .remove(&id)
        .unwrap_or_default()
}

// ==================== МЕНЮ / ТРЕЙ ====================

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let new_conn = MenuItem::with_id(app, "new-connection", "Новое подключение", true, Some("CmdOrCtrl+N"))?;
    let open_ssh = MenuItem::with_id(app, "open-ssh", "Открыть SSH в Terminal", true, Some("CmdOrCtrl+K"))?;
    let run_server = MenuItem::with_id(app, "run-server", "Запустить сервер", true, Some("CmdOrCtrl+R"))?;
    let stop_server = MenuItem::with_id(app, "stop-server", "Остановить сервер", true, Some("CmdOrCtrl+."))?;
    let send_files = MenuItem::with_id(app, "send-files", "Отправить файлы…", true, Some("CmdOrCtrl+O"))?;
    let show_window = MenuItem::with_id(app, "show-window", "Показать окно", true, Some("CmdOrCtrl+Shift+O"))?;

    let file_menu = Submenu::with_items(
        app,
        "Файл",
        true,
        &[
            &new_conn,
            &PredefinedMenuItem::separator(app)?,
            &send_files,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Выход"))?,
        ],
    )?;

    let conn_menu = Submenu::with_items(
        app,
        "Подключение",
        true,
        &[
            &open_ssh,
            &PredefinedMenuItem::separator(app)?,
            &run_server,
            &stop_server,
            &PredefinedMenuItem::separator(app)?,
            &show_window,
        ],
    )?;

    Menu::with_items(app, &[&file_menu, &conn_menu])
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show-window", "Показать окно", true, None::<&str>)?;
    let new_conn = MenuItem::with_id(app, "new-connection", "Новое подключение", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_conn, &quit])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-window" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "new-connection" => {
                let _ = app.emit("tray-new-connection", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let menu = build_menu(&handle)?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let _ = app.emit("menu-event", event.id.as_ref());
    });

    build_tray(&handle)?;

    let list = read_connections(&handle);
    for c in list {
        if c.is_server && c.autostart {
            let address = if c.use_keychain {
                keychain::load_address(&c.id).unwrap_or_default()
            } else {
                c.address.clone()
            };
            if address.is_empty() {
                continue;
            }
            let args = vec!["serve".to_string(), address];
            let _ = run_tailcat(
                handle.clone(),
                handle.state::<AppState>(),
                c.id.clone(),
                args,
            );
        }
    }

    Ok(())
}

// ==================== ПОРТ-ФОРВАРДИНГ ====================

#[tauri::command]
pub fn start_forward(
    app: AppHandle,
    state: State<'_, AppState>,
    forward_manager: State<'_, ForwardManager>,
    rule: PortForwardRule,
    address: String,
) -> Result<u16, String> {
    let mut single = rule.clone();
    single.is_group = false;
    start_forward_internal(app, &state, &forward_manager, single, address, None)?;
    Ok(rule.local_port)
}

fn start_forward_internal(
    app: AppHandle,
    state: &State<'_, AppState>,
    _forward_manager: &State<'_, ForwardManager>,
    rule: PortForwardRule,
    address: String,
    _tag: Option<String>,
) -> Result<u32, String> {
    let local_port_str = if rule.local_port == 0 {
        "0".to_string()
    } else {
        rule.local_port.to_string()
    };

    let mut args = vec!["forward".to_string()];
    if rule.open_browser {
        args.push("--open-browser".to_string());
    }
    args.push(address.clone());
    args.push(format!("{}:{}", local_port_str, rule.remote_port));

    let bin = find_tailcat().ok_or_else(|| "tailcat не найден".to_string())?;

    let mut child = Command::new(&bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .env("PATH", augmented_path())
        .spawn()
        .map_err(|e| format!("Не удалось запустить forward: {e}"))?;

    let pid = child.id();
    let rule_id = rule.id.clone();

    let stats_map = Arc::new(Mutex::new(HashMap::<String, TrafficStats>::new()));
    {
        let global = state.traffic_stats.lock().unwrap();
        let mut local = stats_map.lock().unwrap();
        if let Some(s) = global.get(&rule_id) {
            local.insert(rule_id.clone(), s.clone());
        }
    }

    let app_monitor = app.clone();
    let stats_for_monitor = stats_map.clone();
    spawn_monitor(
        &mut child,
        rule_id.clone(),
        stats_for_monitor,
        move |id, stats| {
            let _ = app_monitor.emit(
                "traffic-update",
                serde_json::json!({ "ruleId": id, "stats": stats }),
            );
        },
    );

    state
        .forward_processes
        .lock()
        .unwrap()
        .insert(rule.id.clone(), pid);

    let app_done = app.clone();
    let rule_id_done = rule.id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let code = status.ok().and_then(|s| s.code());

        let _ = app_done.emit(
            "forward-exit",
            serde_json::json!({ "ruleId": rule_id_done, "code": code }),
        );

        if let Some(state) = app_done.try_state::<AppState>() {
            state.forward_processes.lock().unwrap().remove(&rule_id_done);
        }

        if let Some(fm) = app_done.try_state::<ForwardManager>() {
            if let Ok(mut rules) = fm.rules.lock() {
                if let Some(r) = rules.iter_mut().find(|r| r.id == rule_id_done) {
                    r.active = false;
                }
            }
            if let Ok(mut ports) = fm.active_ports.lock() {
                ports.remove(&rule_id_done);
            }
        }

        if code != Some(0) {
            let _ = app_done
                .notification()
                .builder()
                .title("Tailcat Forward")
                .body(format!("Форвардинг остановлен (код {})", code.unwrap_or(-1)))
                .show();
        }
    });

    Ok(pid)
}

#[tauri::command]
pub fn stop_forward(
    state: State<'_, AppState>,
    forward_manager: State<'_, ForwardManager>,
    rule_id: String,
) -> Result<(), String> {
    if let Some(pid) = state.forward_processes.lock().unwrap().remove(&rule_id) {
        kill_pid(pid);
    }
    if let Ok(mut ports) = forward_manager.active_ports.lock() {
        ports.remove(&rule_id);
    }
    if let Ok(mut rules) = forward_manager.rules.lock() {
        if let Some(r) = rules.iter_mut().find(|r| r.id == rule_id) {
            r.active = false;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_forwards(forward_manager: State<'_, ForwardManager>) -> Vec<PortForwardRule> {
    forward_manager.rules.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_forward_rule(
    app: AppHandle,
    forward_manager: State<'_, ForwardManager>,
    rule: PortForwardRule,
) -> Result<(), String> {
    let mut rules = forward_manager.rules.lock().unwrap();
    if let Some(existing) = rules.iter_mut().find(|r| r.id == rule.id) {
        *existing = rule;
    } else {
        rules.push(rule);
    }

    let path = config_file(&app)?.with_file_name("forwards.json");
    let json = serde_json::to_string_pretty(&*rules).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_forward_rule(
    app: AppHandle,
    forward_manager: State<'_, ForwardManager>,
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<(), String> {
    if let Some(pid) = state.forward_processes.lock().unwrap().remove(&rule_id) {
        kill_pid(pid);
    }

    let mut rules = forward_manager.rules.lock().unwrap();
    rules.retain(|r| r.id != rule_id);

    let path = config_file(&app)?.with_file_name("forwards.json");
    let json = serde_json::to_string_pretty(&*rules).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== ГРУППОВЫЕ ПРАВИЛА ====================

#[tauri::command]
pub fn start_group_forward(
    app: AppHandle,
    state: State<'_, AppState>,
    forward_manager: State<'_, ForwardManager>,
    rule: PortForwardRule,
    addresses: HashMap<String, String>,
) -> Result<Vec<String>, String> {
    let mut pids = Vec::new();
    let mut results = Vec::new();

    for conn_id in &rule.connection_ids {
        let address = addresses
            .get(conn_id)
            .ok_or_else(|| format!("Не найден адрес для подключения {conn_id}"))?
            .clone();

        let mut single_rule = rule.clone();
        single_rule.is_group = false;
        single_rule.connection_ids = vec![conn_id.clone()];

        match start_forward_internal(
            app.clone(),
            &state,
            &forward_manager,
            single_rule,
            address,
            Some(conn_id.clone()),
        ) {
            Ok(pid) => {
                pids.push(pid);
                results.push(format!("{conn_id}: запущен (PID {pid})"));
            }
            Err(e) => {
                results.push(format!("{conn_id}: ошибка — {e}"));
            }
        }
    }

    state
        .group_processes
        .lock()
        .unwrap()
        .insert(rule.id.clone(), pids);

    {
        let mut rules = forward_manager.rules.lock().unwrap();
        let mut updated = rule.clone();
        updated.active = true;
        if let Some(existing) = rules.iter_mut().find(|r| r.id == rule.id) {
            *existing = updated;
        } else {
            rules.push(updated);
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn stop_group_forward(
    state: State<'_, AppState>,
    forward_manager: State<'_, ForwardManager>,
    rule_id: String,
) -> Result<(), String> {
    if let Ok(mut groups) = state.group_processes.lock() {
        if let Some(pids) = groups.remove(&rule_id) {
            for pid in pids {
                kill_pid(pid);
            }
        }
    }
    if let Ok(mut rules) = forward_manager.rules.lock() {
        if let Some(r) = rules.iter_mut().find(|r| r.id == rule_id) {
            r.active = false;
        }
    }
    Ok(())
}

// ==================== МОНИТОРИНГ ТРАФИКА ====================

#[tauri::command]
pub fn get_traffic_stats(state: State<'_, AppState>, rule_id: String) -> TrafficStats {
    state
        .traffic_stats
        .lock()
        .unwrap()
        .get(&rule_id)
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_all_traffic_stats(state: State<'_, AppState>) -> HashMap<String, TrafficStats> {
    state.traffic_stats.lock().unwrap().clone()
}

#[tauri::command]
pub fn reset_traffic_stats(state: State<'_, AppState>, rule_id: String) {
    state.traffic_stats.lock().unwrap().remove(&rule_id);
}

// ==================== EXIT-NODE ====================

#[tauri::command]
pub fn start_exit_node(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    address: String,
    extra_args: Vec<String>,
) -> Result<(), String> {
    if let Some(pid) = state.processes.lock().unwrap().remove(&id) {
        kill_pid(pid);
    }

    let mut args = vec!["serve".to_string(), "--serve=exit-node".to_string()];
    args.extend(extra_args);
    args.push(address);

    run_tailcat(app.clone(), app.state::<AppState>(), id.clone(), args)?;

    if let Some(state) = app.try_state::<AppState>() {
        state.exit_node_active.lock().unwrap().insert(id, true);
    }

    Ok(())
}

#[tauri::command]
pub fn stop_exit_node(app: AppHandle, id: String) -> Result<(), String> {
    stop_process(app.state::<AppState>(), id.clone())?;
    if let Some(state) = app.try_state::<AppState>() {
        state.exit_node_active.lock().unwrap().remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn get_exit_node_status(state: State<'_, AppState>, id: String) -> bool {
    state
        .exit_node_active
        .lock()
        .unwrap()
        .get(&id)
        .copied()
        .unwrap_or(false)
}

#[tauri::command]
pub fn check_exit_node_capable(_address: String) -> Result<bool, String> {
    Ok(true)
}
