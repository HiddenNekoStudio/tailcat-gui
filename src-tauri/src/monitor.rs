use std::io::{BufRead, BufReader};
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::{TrafficPoint, TrafficStats};

pub fn spawn_monitor(
    child: &mut Child,
    rule_id: String,
    stats: Arc<Mutex<std::collections::HashMap<String, TrafficStats>>>,
    on_update: impl Fn(String, TrafficStats) + Send + Sync + 'static,
) {
    let on_update = Arc::new(on_update);

    if let Some(stdout) = child.stdout.take() {
        let rule_id = rule_id.clone();
        let stats = stats.clone();
        let on_update = on_update.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                parse_and_update(&rule_id, &line, &stats, &on_update);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let rule_id = rule_id.clone();
        let stats = stats.clone();
        let on_update = on_update.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                parse_and_update(&rule_id, &line, &stats, &on_update);
            }
        });
    }
}

fn parse_and_update(
    rule_id: &str,
    line: &str,
    stats: &Arc<Mutex<std::collections::HashMap<String, TrafficStats>>>,
    on_update: &Arc<impl Fn(String, TrafficStats)>,
) {
    let lower = line.to_lowercase();
    let mut sent = 0u64;
    let mut received = 0u64;

    if lower.contains("sent") || lower.contains("upload") {
        sent = extract_first_number(line).unwrap_or(0);
    } else if lower.contains("received") || lower.contains("download") {
        received = extract_first_number(line).unwrap_or(0);
    } else if lower.contains("bytes") {
        sent = extract_first_number(line).unwrap_or(0);
    }

    if sent == 0 && received == 0 {
        return;
    }

    if let Ok(mut map) = stats.lock() {
        let entry = map.entry(rule_id.to_string()).or_default();
        entry.bytes_sent += sent;
        entry.bytes_received += received;
        entry.last_updated = now_secs();
        push_history(entry);
        let snapshot = entry.clone();
        drop(map);
        on_update(rule_id.to_string(), snapshot);
    }
}

fn extract_first_number(s: &str) -> Option<u64> {
    let mut num = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            num.push(ch);
        } else if !num.is_empty() {
            break;
        }
    }
    num.parse().ok()
}

fn push_history(entry: &mut TrafficStats) {
    let now = now_secs();
    if entry.history.len() >= 60 {
        entry.history.remove(0);
    }
    entry.history.push(TrafficPoint {
        timestamp: now,
        sent: entry.bytes_sent,
        received: entry.bytes_received,
    });
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
