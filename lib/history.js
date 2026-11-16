// lib/history.js — 发送历史（设置页列表与命令行共用同一份文件）
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./session.js";

const MAX_RECORDS = 200;

function historyFile() {
  return path.join(dataDir(), "history.json");
}

export function readHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(historyFile(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordHistory(entry) {
  const record = {
    at: new Date().toISOString(),
    action: String(entry.action || "send_file"),
    ok: Boolean(entry.ok),
    fileName: String(entry.fileName || ""),
    filePath: String(entry.filePath || ""),
    size: Number(entry.size) || 0,
    chunks: Number(entry.chunks) || 0,
    msgId: String(entry.msgId || ""),
    elapsedMs: Number(entry.elapsedMs) || 0,
    error: String(entry.error || ""),
  };
  const list = [record, ...readHistory()].slice(0, MAX_RECORDS);
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(list, null, 2), { mode: 0o600 });
  } catch {
    /* 历史写失败不影响发送 */
  }
  return record;
}

export function formatBytesShort(n) {
  const size = Number(n) || 0;
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / 1024 / 1024).toFixed(2) + " MB";
}
