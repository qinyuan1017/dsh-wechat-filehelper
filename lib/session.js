// lib/session.js — 登录态落盘（cookie + skey/wxuin/sid/pass_ticket/deviceId）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function defaultDataDir() {
  if (process.env.DSH_WECHAT_FH_DIR) return process.env.DSH_WECHAT_FH_DIR;
  return path.join(os.homedir(), ".dsh", "data", "dsh-wechat-filehelper");
}

export function dataDir() {
  const dir = defaultDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionFile() {
  return path.join(dataDir(), "session.json");
}

/** 极简 cookie jar：webwx 只用少数几个 cookie，够用且可序列化。 */
export class CookieJar {
  constructor(list = []) {
    this.map = new Map();
    for (const item of list) {
      if (item && item.name) this.map.set(item.name, String(item.value ?? ""));
    }
  }
  set(name, value) {
    if (!name) return;
    this.map.set(name, String(value ?? ""));
  }
  get(name) {
    return this.map.get(name);
  }
  header() {
    return [...this.map].map(([k, v]) => k + "=" + v).join("; ");
  }
  absorbSetCookie(lines = []) {
    for (const line of lines) {
      const first = String(line).split(";")[0];
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name && value) this.set(name, value);
    }
  }
  toJSON() {
    return [...this.map].map(([name, value]) => ({ name, value }));
  }
}

export function newDeviceId() {
  // webwx 的 DeviceID 形如 e123456789012345，固定后不要每次重生成（风控）
  const prefix = "e";
  let s = "";
  for (let i = 0; i < 15; i += 1) s += Math.floor(Math.random() * 10);
  return prefix + s;
}

export function emptySession() {
  return {
    version: 1,
    createdAt: 0,
    savedAt: 0,
    cookie: [],
    skey: "",
    wxsid: "",
    wxuin: "",
    passTicket: "",
    deviceId: newDeviceId(),
    userName: "",
    nickName: "",
    syncKey: null,
  };
}

export function loadSession() {
  try {
    const raw = fs.readFileSync(sessionFile(), "utf8");
    const parsed = JSON.parse(raw);
    const base = emptySession();
    const merged = { ...base, ...parsed };
    if (!merged.deviceId) merged.deviceId = newDeviceId();
    return merged;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  const file = sessionFile();
  const payload = { ...session, savedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows 上忽略 */
  }
  return payload;
}

export function clearSession() {
  try {
    fs.unlinkSync(sessionFile());
    return true;
  } catch {
    return false;
  }
}

/** 是否具备最小可用登录态（init 之后才算完整） */
export function isLoggedIn(session) {
  return Boolean(session && session.skey && session.wxuin && session.userName);
}

export function jarOf(session) {
  return new CookieJar(session?.cookie || []);
}

export function persistJar(session, jar) {
  session.cookie = jar.toJSON();
  return session;
}
