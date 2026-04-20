use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent};

const DESKTOP_WEB_PORT: u16 = 3210;

#[derive(Default)]
struct NextServerState(Mutex<Option<Child>>);

fn start_next_server(app: &AppHandle) -> Result<(), String> {
  let resource_dir = app
    .path()
    .resource_dir()
    .map_err(|err| format!("failed to resolve resources directory: {err}"))?;

  let web_dir = resource_dir.join("web");
  let server_js = web_dir.join("server.js");

  if !server_js.exists() {
    return Err(format!(
      "desktop web server entrypoint is missing at {}",
      server_js.display()
    ));
  }

  let child = Command::new("node")
    .arg(server_js)
    .current_dir(&web_dir)
    .env("HOSTNAME", "127.0.0.1")
    .env("PORT", DESKTOP_WEB_PORT.to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|err| format!("failed to start packaged Next.js server: {err}"))?;

  let state = app.state::<NextServerState>();
  let mut guard = state.0.lock().map_err(|_| String::from("next server state lock poisoned"))?;
  *guard = Some(child);

  Ok(())
}

fn stop_next_server(app: &AppHandle) {
  let state = app.state::<NextServerState>();

  if let Ok(mut guard) = state.0.lock() {
    if let Some(mut child) = guard.take() {
      if let Err(err) = child.kill() {
        eprintln!("failed to stop packaged Next.js server: {err}");
      }

      if let Err(err) = child.wait() {
        eprintln!("failed waiting for packaged Next.js server shutdown: {err}");
      }
    }
  }
}

fn main() {
  tauri::Builder::default()
    .manage(NextServerState::default())
    .setup(|app| {
      if !cfg!(debug_assertions) {
        start_next_server(app.handle()).map_err(tauri::Error::Setup)?;
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running GHchat desktop shell")
    .run(|app_handle, event| {
      if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
        stop_next_server(&app_handle);
      }
    });
}
