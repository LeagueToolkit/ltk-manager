use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use fs_err as fs;

use super::IntegrationError;
use crate::platform::hide_console;

pub(super) fn run(executable: &Path, args: &[&str]) -> Result<String, IntegrationError> {
    let log = tempfile::NamedTempFile::new()?;
    let output = fs::File::create(log.path())?;
    let error_output = output.try_clone()?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(output.into_file())
        .stderr(error_output.into_file());
    hide_console(&mut command);
    let mut child = command.spawn()?;
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(60)
            || fs::metadata(log.path())?.len() > 1024 * 1024
        {
            child.kill()?;
            child.wait()?;
            return Err(IntegrationError::Operation {
                detail: "tool process timed out".into(),
            });
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut bytes = Vec::new();
    fs::File::open(log.path())?
        .take(64 * 1024)
        .read_to_end(&mut bytes)?;
    let output = String::from_utf8_lossy(&bytes).into_owned();
    if !status.success() {
        return Err(IntegrationError::Operation {
            detail: format!("{status}: {output}"),
        });
    }
    Ok(output)
}
