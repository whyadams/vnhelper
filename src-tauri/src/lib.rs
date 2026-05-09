use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, Wry,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrayTask {
    pub id: String,
    pub title: String,
    pub column: String,
}

#[derive(Default)]
struct TrayState {
    tasks: Mutex<Vec<TrayTask>>,
}

const TRAY_ID: &str = "main-tray";
const MENU_TASK_PREFIX: &str = "task::";
const MENU_SHOW: &str = "show-window";
const MENU_QUIT: &str = "quit-app";
const MAX_TASKS_IN_MENU: usize = 30;

fn build_menu(app: &AppHandle, tasks: &[TrayTask]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    let header_text = if tasks.is_empty() {
        "No active tasks".to_string()
    } else {
        format!("Active tasks: {}", tasks.len())
    };
    let header = MenuItem::with_id(app, "header", header_text, false, None::<&str>)?;
    menu.append(&header)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if tasks.is_empty() {
        let empty = MenuItem::with_id(
            app,
            "empty",
            "Open VnHelper to add tasks",
            false,
            None::<&str>,
        )?;
        menu.append(&empty)?;
    } else {
        for t in tasks.iter().take(MAX_TASKS_IN_MENU) {
            let title = truncate_label(&t.title, 64);
            let label = format!("[{}]  {}", short_column(&t.column), title);
            let id = format!("{}{}", MENU_TASK_PREFIX, t.id);
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            menu.append(&item)?;
        }
        if tasks.len() > MAX_TASKS_IN_MENU {
            let more = MenuItem::with_id(
                app,
                "more",
                format!("…and {} more", tasks.len() - MAX_TASKS_IN_MENU),
                false,
                None::<&str>,
            )?;
            menu.append(&more)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let show = MenuItem::with_id(app, MENU_SHOW, "Show VnHelper", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    menu.append(&show)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn truncate_label(s: &str, max_chars: usize) -> String {
    let collected: Vec<char> = s.chars().collect();
    if collected.len() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = collected.into_iter().take(max_chars - 1).collect();
        out.push('…');
        out
    }
}

fn short_column(key: &str) -> &str {
    match key {
        "todo" => "TODO",
        "progress" => "WIP",
        "review" => "REV",
        "done" => "DONE",
        other => other,
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id.as_ref();
    if id == MENU_QUIT {
        app.exit(0);
        return;
    }
    if id == MENU_SHOW {
        show_main_window(app);
        return;
    }
    if let Some(card_id) = id.strip_prefix(MENU_TASK_PREFIX) {
        show_main_window(app);
        let _ = app.emit("tray://focus-task", card_id.to_string());
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct McpAuth {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user_id: String,
    pub email: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpAuthResult {
    pub path: String,
}

fn vnhelper_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("home dir not found")?;
    Ok(home.join(".vnhelper"))
}

#[tauri::command]
fn write_mcp_auth(auth: McpAuth) -> Result<McpAuthResult, String> {
    let dir = vnhelper_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("auth.json");
    let json = serde_json::to_string_pretty(&auth).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(McpAuthResult {
        path: path.to_string_lossy().into_owned(),
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct McpEnv {
    pub supabase_url: String,
    pub supabase_anon_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_project_id: Option<String>,
}

#[tauri::command]
fn write_mcp_env(env: McpEnv) -> Result<McpAuthResult, String> {
    let dir = vnhelper_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("env.json");
    let json = serde_json::to_string_pretty(&env).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(McpAuthResult {
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn mcp_dir() -> Result<String, String> {
    let dir = vnhelper_dir()?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn update_tray_tasks(
    app: AppHandle,
    state: State<'_, TrayState>,
    tasks: Vec<TrayTask>,
) -> Result<(), String> {
    {
        let mut guard = state.tasks.lock().map_err(|e| e.to_string())?;
        *guard = tasks.clone();
    }
    let menu = build_menu(&app, &tasks).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        let tooltip = if tasks.is_empty() {
            "VnHelper — no active tasks".to_string()
        } else {
            format!("VnHelper — {} active task(s)", tasks.len())
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(TrayState::default())
        .invoke_handler(tauri::generate_handler![
            update_tray_tasks,
            write_mcp_auth,
            write_mcp_env,
            mcp_dir,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let menu = build_menu(&handle, &[])?;
            let icon = app
                .default_window_icon()
                .ok_or("no default window icon")?
                .clone();
            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .tooltip("VnHelper")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_menu_event(app, event))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
