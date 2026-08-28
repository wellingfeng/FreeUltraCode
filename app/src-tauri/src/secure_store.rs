use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

const SERVICE_NAME: &str = "UltraGameStudio";
const MAX_SECRET_KEY_LEN: usize = 160;
// Windows Generic Credentials cap the credential blob at 2560 bytes. Keep each
// UTF-16 payload below that limit and transparently shard larger logical values.
const MAX_SECRET_CHUNK_UTF16_UNITS: usize = 1000;
const CHUNK_MANIFEST_PREFIX: &str = "UGS_CHUNKED_SECRET_V1:";
static CHUNK_GENERATION: AtomicU64 = AtomicU64::new(1);

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

fn raw_secret_get(key: &str) -> Result<Option<String>, String> {
    let entry = entry_for_key(key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取系统安全存储失败: {err}")),
    }
}

fn raw_secret_set(key: &str, value: &str) -> Result<(), String> {
    entry_for_key(key)?
        .set_password(value)
        .map_err(|e| format!("写入系统安全存储失败: {e}"))
}

fn raw_secret_delete(key: &str) -> Result<(), String> {
    match entry_for_key(key)?.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除系统安全存储失败: {err}")),
    }
}

fn stable_key_hash(value: &str) -> u64 {
    // FNV-1a: deterministic across processes, compact, and sufficient for
    // deriving private keychain entry names from an already-validated key.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn chunk_key(key: &str, generation: &str, index: usize) -> String {
    format!(
        "ugs.secret.chunk.{:016x}.{generation}.{index}",
        stable_key_hash(key)
    )
}

fn chunk_manifest(generation: &str, count: usize) -> String {
    format!("{CHUNK_MANIFEST_PREFIX}{generation}:{count}")
}

fn parse_chunk_manifest(value: &str) -> Option<(&str, usize)> {
    let rest = value.strip_prefix(CHUNK_MANIFEST_PREFIX)?;
    let (generation, count) = rest.rsplit_once(':')?;
    if generation.is_empty() {
        return None;
    }
    let count = count.parse::<usize>().ok()?;
    (count > 0).then_some((generation, count))
}

fn split_secret_chunks(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut utf16_units = 0;
    for ch in value.chars() {
        let char_units = ch.len_utf16();
        if !current.is_empty() && utf16_units + char_units > MAX_SECRET_CHUNK_UTF16_UNITS {
            chunks.push(std::mem::take(&mut current));
            utf16_units = 0;
        }
        current.push(ch);
        utf16_units += char_units;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn delete_manifest_chunks(key: &str, manifest: &str) {
    let Some((generation, count)) = parse_chunk_manifest(manifest) else {
        return;
    };
    for index in 0..count {
        let _ = raw_secret_delete(&chunk_key(key, generation, index));
    }
}

fn secure_secret_get_blocking(key: String) -> Result<Option<String>, String> {
    let Some(value) = raw_secret_get(&key)? else {
        return Ok(None);
    };
    let Some((generation, count)) = parse_chunk_manifest(&value) else {
        return Ok(Some(value));
    };
    let mut combined = String::new();
    for index in 0..count {
        let part_key = chunk_key(&key, generation, index);
        let part = raw_secret_get(&part_key)?
            .ok_or_else(|| format!("系统安全存储分片缺失: {part_key}"))?;
        combined.push_str(&part);
    }
    Ok(Some(combined))
}

fn secure_secret_set_blocking(key: String, value: String) -> Result<(), String> {
    if value.is_empty() {
        return secure_secret_delete_blocking(key);
    }
    let previous = raw_secret_get(&key)?;
    if value.encode_utf16().count() <= MAX_SECRET_CHUNK_UTF16_UNITS {
        raw_secret_set(&key, &value)?;
        if let Some(manifest) = previous.as_deref() {
            delete_manifest_chunks(&key, manifest);
        }
        return Ok(());
    }

    let generation = format!(
        "{:x}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        CHUNK_GENERATION.fetch_add(1, Ordering::Relaxed),
    );
    let chunks = split_secret_chunks(&value);
    let mut written: Vec<String> = Vec::with_capacity(chunks.len());
    for (index, chunk) in chunks.iter().enumerate() {
        let part_key = chunk_key(&key, &generation, index);
        if let Err(err) = raw_secret_set(&part_key, chunk) {
            for written_key in written {
                let _ = raw_secret_delete(&written_key);
            }
            return Err(err);
        }
        written.push(part_key);
    }
    let manifest = chunk_manifest(&generation, chunks.len());
    if let Err(err) = raw_secret_set(&key, &manifest) {
        for written_key in written {
            let _ = raw_secret_delete(&written_key);
        }
        return Err(err);
    }
    if let Some(old_manifest) = previous.as_deref() {
        delete_manifest_chunks(&key, old_manifest);
    }
    Ok(())
}

fn secure_secret_delete_blocking(key: String) -> Result<(), String> {
    let previous = raw_secret_get(&key)?;
    raw_secret_delete(&key)?;
    if let Some(manifest) = previous.as_deref() {
        delete_manifest_chunks(&key, manifest);
    }
    Ok(())
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn oversized_secret_round_trips_through_windows_credential_manager() {
        let key = format!(
            "test.large-secret.{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let record: HashMap<String, String> = (0..20)
            .map(|index| {
                (
                    format!("provider-{index:02}-00000000-0000-0000-0000-000000000000"),
                    format!("sk-{index:02}-{}", "x".repeat(64)),
                )
            })
            .collect();
        let value = serde_json::to_string(&record).unwrap();
        assert!(value.encode_utf16().count() * 2 > 2_560);

        let result = secure_secret_set_blocking(key.clone(), value.clone());
        let round_trip = if result.is_ok() {
            secure_secret_get_blocking(key.clone())
        } else {
            Ok(None)
        };
        secure_secret_delete_blocking(key.clone()).expect("test secret cleanup must succeed");
        assert_eq!(secure_secret_get_blocking(key).unwrap(), None);

        result.expect("large secrets must be transparently chunked");
        assert_eq!(round_trip.unwrap(), Some(value));
    }

    #[test]
    fn chunked_secret_can_be_replaced_by_a_short_value() {
        let key = format!(
            "test.large-secret-replace.{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        secure_secret_set_blocking(key.clone(), "密钥".repeat(1_500)).unwrap();
        secure_secret_set_blocking(key.clone(), "short-value".to_string()).unwrap();
        let round_trip = secure_secret_get_blocking(key.clone()).unwrap();
        secure_secret_delete_blocking(key.clone()).expect("test secret cleanup must succeed");
        assert_eq!(secure_secret_get_blocking(key).unwrap(), None);

        assert_eq!(round_trip.as_deref(), Some("short-value"));
    }
}
