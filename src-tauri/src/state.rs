use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub processes: Mutex<HashMap<String, u32>>,
    pub autostart: Mutex<HashMap<String, bool>>,
    pub pending_files: Mutex<HashMap<String, Vec<String>>>,
    pub forward_processes: Mutex<HashMap<String, u32>>,
    pub exit_node_active: Mutex<HashMap<String, bool>>,
    pub traffic_stats: Mutex<HashMap<String, TrafficStats>>,
    pub group_processes: Mutex<HashMap<String, Vec<u32>>>,
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficStats {
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub connections: u64,
    pub last_updated: u64,
    pub history: Vec<TrafficPoint>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficPoint {
    pub timestamp: u64,
    pub sent: u64,
    pub received: u64,
}
