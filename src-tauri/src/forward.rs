use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardRule {
    pub id: String,
    pub connection_ids: Vec<String>,
    pub local_port: u16,
    pub remote_port: u16,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub open_browser: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub is_group: bool,
}

pub struct ForwardManager {
    pub rules: Mutex<Vec<PortForwardRule>>,
    pub active_ports: Mutex<HashMap<String, u16>>,
}

impl Default for ForwardManager {
    fn default() -> Self {
        Self {
            rules: Mutex::new(Vec::new()),
            active_ports: Mutex::new(HashMap::new()),
        }
    }
}
