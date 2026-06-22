use std::collections::HashMap;

const SERVICE_NAME: &str = "UltraGameStudio";
const MAX_SECRET_KEY_LEN: usize = 160;

fn normalize_secret_key(key: &str) -> Result<String, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("安全存储 key 不能为空。".to_string());
    }
    if trimmed.len() > MAX_SECRET_KEY_LEN {
        return Err("安全存储 key 过长。".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '/'))
    {
        return Err("安全存储 key 包含非法字符。".to_string());
    }
    Ok(trimmed.to_string())
}

fn entry_for_key(key: &str) -> Result<keyring::Entry, String> {
    let key = normalize_secret_key(key)?;
    keyring::Entry::new(SERVICE_NAME, &key).map_err(|e| format!("打开系统安全存储失败: {e}"))
}

fn secure_secret_get_blocking(key: String) -> Result<Option<String>, String> {
    let entry = entry_for_key(&key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取系统安全存储失败: {err}")),
    }
}

fn secure_secret_set_blocking(key: String, value: String) -> Result<(), String> {
    let entry = entry_for_key(&key)?;
    if value.is_empty() {
        return secure_secret_delete_blocking(key);
    }
    entry
        .set_password(&value)
        .map_err(|e| format!("写入系统安全存储失败: {e}"))
}

fn secure_secret_delete_blocking(key: String) -> Result<(), String> {
    let entry = entry_for_key(&key)?;
    match entry.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除系统安全存储失败: {err}")),
    }
}

#[tauri::command]
pub async fn secure_secret_get_many(keys: Vec<String>) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = HashMap::new();
        for key in keys {
            let normalized = normalize_secret_key(&key)?;
            if let Some(value) = secure_secret_get_blocking(normalized.clone())? {
                out.insert(normalized, value);
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("安全存储读取任务失败: {e}"))?
}

#[tauri::command]
pub async fn secure_secret_set(key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_secret_set_blocking(key, value))
        .await
        .map_err(|e| format!("安全存储写入任务失败: {e}"))?
}

#[tauri::command]
pub async fn secure_secret_delete(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secure_secret_delete_blocking(key))
        .await
        .map_err(|e| format!("安全存储删除任务失败: {e}"))?
}
