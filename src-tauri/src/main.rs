#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod forward;
mod keychain;
mod monitor;
mod state;

use tauri::Manager;

use commands::*;
use forward::ForwardManager;
use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .manage(ForwardManager::default())
        .setup(|app| {
            commands::setup_app(app)?;
            // Загружаем сохранённые правила форвардинга
            let handle = app.handle().clone();
            let fm = handle.state::<ForwardManager>();
            if let Ok(config_dir) = handle.path().app_config_dir() {
                let path = config_dir.join("forwards.json");
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(rules) = serde_json::from_str::<Vec<crate::forward::PortForwardRule>>(&content) {
                        *fm.rules.lock().unwrap() = rules;
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_tailcat,
            list_connections,
            save_connection,
            delete_connection,
            run_tailcat,
            stop_process,
            open_in_terminal,
            send_files,
            pick_and_send_files,
            register_dropped_files,
            take_dropped_files,
            start_forward,
            stop_forward,
            list_forwards,
            save_forward_rule,
            delete_forward_rule,
            start_group_forward,
            stop_group_forward,
            get_traffic_stats,
            get_all_traffic_stats,
            reset_traffic_stats,
            start_exit_node,
            stop_exit_node,
            get_exit_node_status,
            check_exit_node_capable,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
