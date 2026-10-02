//! What a hot reload does to League outside the patcher: kill the game, and ask the client to
//! reconnect to the game it just lost.

use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use fs_err as fs;
use reqwest::Method;
use reqwest::blocking::Client;

use super::wait_for_game_exit;

/// How long a killed game gets to release its archives.
const GAME_EXIT_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the kill command itself gets to finish.
const KILL_TIMEOUT: Duration = Duration::from_secs(3);

/// How long one reconnect request may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// The wait before each reconnect attempt. The client needs time to process the game exit
/// before it accepts one.
const RETRY_DELAYS: [Duration; 5] = [
    Duration::from_secs(3),
    Duration::from_secs(3),
    Duration::from_secs(5),
    Duration::from_secs(5),
    Duration::from_secs(5),
];

/// The requests one reconnect attempt tries, in order.
const RECONNECT_ENDPOINTS: [(Method, &str); 3] = [
    (Method::POST, "/lol-gameflow/v1/reconnect"),
    (Method::PUT, "/lol-gameflow/v1/reconnect"),
    (Method::POST, "/lol-login/v1/session/reconnect"),
];

/// Where the League client listens, as its lockfile names it.
#[derive(Debug, PartialEq, Eq)]
struct Lockfile {
    port: u16,
    password: String,
}

/// Kill the League game process and wait for it to exit.
pub fn kill_game() {
    tracing::info!("Killing League of Legends process");

    #[cfg(target_os = "windows")]
    let result = Command::new("taskkill")
        .args(["/F", "/IM", "League of Legends.exe"])
        .spawn();

    #[cfg(not(target_os = "windows"))]
    let result = Command::new("pkill")
        .args(["-f", "League of Legends"])
        .spawn();

    match result {
        Ok(mut child) => {
            let start = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > KILL_TIMEOUT {
                            tracing::warn!("kill command timed out");
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        tracing::warn!("Error waiting for kill command: {}", e);
                        break;
                    }
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to spawn kill command: {}", e);
        }
    }

    if !wait_for_game_exit(GAME_EXIT_TIMEOUT) {
        tracing::warn!(
            "League of Legends still running {}s after the kill",
            GAME_EXIT_TIMEOUT.as_secs()
        );
    }
}

/// Ask the League client installed at `league_path` to reconnect to its game, retrying while
/// it processes the game exit. Best-effort, and blocking for up to half a minute.
pub fn reconnect_client(league_path: &Path) {
    let Some(lockfile) = read_lockfile(league_path) else {
        tracing::debug!("No lockfile found, skipping LCU reconnect");
        return;
    };

    let client = match Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(REQUEST_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            tracing::warn!("Failed to build HTTP client for LCU: {}", e);
            return;
        }
    };

    for (attempt, delay) in RETRY_DELAYS.iter().enumerate() {
        tracing::debug!(
            "LCU reconnect: waiting {}s before attempt {} of {}",
            delay.as_secs(),
            attempt + 1,
            RETRY_DELAYS.len()
        );
        std::thread::sleep(*delay);

        if reconnect_once(&client, &lockfile) {
            return;
        }
    }

    tracing::debug!("LCU reconnect: all attempts exhausted (client may not need reconnect)");
}

/// One reconnect attempt over every endpoint, and whether one accepted it.
fn reconnect_once(client: &Client, lockfile: &Lockfile) -> bool {
    for (method, path) in &RECONNECT_ENDPOINTS {
        let url = format!("https://127.0.0.1:{}{}", lockfile.port, path);
        tracing::debug!("Trying LCU reconnect: {} {}", method, url);

        let result = client
            .request(method.clone(), &url)
            .basic_auth("riot", Some(&lockfile.password))
            .header("Content-Type", "application/json")
            .send();

        match result {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!("LCU reconnect succeeded via {} {}", method, path);
                return true;
            }
            Ok(resp) => {
                tracing::debug!("LCU {} {} returned {}", method, path, resp.status());
            }
            Err(e) => {
                tracing::debug!("LCU {} {} failed: {}", method, path, e);
            }
        }
    }

    false
}

/// The lockfile of the client installed at `league_path`.
///
/// The format is `process:pid:port:password:protocol`, or `process:port:password:protocol` in
/// older clients.
fn read_lockfile(league_path: &Path) -> Option<Lockfile> {
    let lockfile_path = league_path.join("lockfile");

    let content = match fs::read_to_string(&lockfile_path) {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("Could not read lockfile at {:?}: {}", lockfile_path, e);
            return None;
        }
    };

    parse_lockfile(&content)
}

/// The port and password a lockfile's `content` names.
fn parse_lockfile(content: &str) -> Option<Lockfile> {
    let parts: Vec<&str> = content.trim().split(':').collect();

    let (port, password) = match parts.len() {
        4 => (parts[1], parts[2]),
        5 => (parts[2], parts[3]),
        n if n > 5 => {
            tracing::warn!("Lockfile has {} parts, reading it as the 5-part format", n);
            (parts[2], parts[3])
        }
        n => {
            tracing::warn!("Invalid lockfile format: {} parts", n);
            return None;
        }
    };

    let port = port.parse::<u16>().ok()?;
    tracing::debug!("Parsed lockfile ({} parts): port={}", parts.len(), port);

    Some(Lockfile {
        port,
        password: password.to_owned(),
    })
}

#[cfg(test)]
mod tests;
