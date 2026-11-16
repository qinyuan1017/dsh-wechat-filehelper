// lib/filehelper.js — 业务层：扫码登录状态机 / 发文件 / 发文本 / 收件列表 / 下载
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import * as wx from "./webwx.js";
import {
  CookieJar,
  dataDir,
  loadSession,
  saveSession,
  clearSession,
  isLoggedIn,
  jarOf,
  persistJar,
  newDeviceId,
  emptySession,
} from "./session.js";
import { recordHistory, readHistory as readHistorySafe } from "./history.js";

const PENDING_TTL_MS = 5 * 60 * 1000;

function pendingFile() {
  return path.join(dataDir(), "pending.json");
}
function recentFile() {
  return path.join(dataDir(), "recent.json");
}

function readPending() {
  try {
    const data = JSON.parse(fs.readFileSync(pendingFile(), "utf8"));
    if (data && data.uuid && Date.now() - Number(data.createdAt || 0) < PENDING_TTL_MS) return data;
  } catch {
    /* 没有待扫码状态 */
  }
  return null;
}
function writePending(pending) {
  fs.writeFileSync(pendingFile(), JSON.stringify(pending), { mode: 0o600 });
}
function clearPending() {
  try {
    fs.unlinkSync(pendingFile());
  } catch {
    /* ignore */
  }
}

function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeRecent(list) {
  try {
    fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 50)), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function safeName(raw) {
  let out = String(raw || "file");
  for (const ch of ["<", ">", ":", '"', "/", "\\", "|", "?", "*"]) out = out.split(ch).join("_");
  out = out.trim().slice(0, 120);
  return out || "file";
}

function friendlyError(err) {
  const message = String((err && err.message) || err || "未知错误");
  if (message.includes("1101") || message.includes("1102")) return message + "（登录态已失效，请重新 login 扫码）";
  if (message.includes("操作过于频繁")) return message + "（微信频控，等 10~30 分钟再试）";
  return message;
}

function writeLastError(err, jar) {
  try {
    fs.writeFileSync(
      path.join(dataDir(), "last-error.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          message: String((err && err.message) || err),
          rawXml: (err && err.rawXml) || "",
          cookieNames: jar.toJSON().map((c) => c.name),
        },
        null,
        2
      )
    );
  } catch {
    /* 诊断落盘失败不影响主流程 */
  }
}

/** 200 之后：拿 ticket 换登录凭证 → 落 session → init 拿 UserName/SyncKey */
async function finishLogin(redirectUri, jar) {
  const creds = await wx.completeLogin(redirectUri, jar);
  const session = emptySession();
  session.createdAt = Date.now();
  session.skey = creds.skey;
  session.wxsid = creds.wxsid;
  session.wxuin = creds.wxuin;
  session.passTicket = creds.passTicket;
  const previous = loadSession();
  session.deviceId = (previous && previous.deviceId) || newDeviceId();
  try {
    session.baseUrl = new URL(redirectUri).origin;
  } catch {
    /* 保持默认 filehelper 域 */
  }
  persistJar(session, jar);
  const init = await wx.webwxInit(session, jar);
  session.userName = (init && init.User && init.User.UserName) || "";
  session.nickName = (init && init.User && init.User.NickName) || "";
  session.syncKey = (init && init.SyncKey) || null;
  saveSession(session);
  clearPending();
  return { state: "online", nickName: session.nickName, userName: session.userName };
}

export function createClient() {
  function status() {
    const session = loadSession();
    const pending = readPending();
    return {
      loggedIn: isLoggedIn(session),
      nickName: (session && session.nickName) || "",
      userName: (session && session.userName) || "",
      savedAt: session && session.savedAt ? new Date(session.savedAt).toISOString() : "",
      hasPendingQr: Boolean(pending),
      pendingExpiresInSec: pending ? Math.max(0, Math.round((PENDING_TTL_MS - (Date.now() - pending.createdAt)) / 1000)) : 0,
      dataDir: dataDir(),
    };
  }

  async function login() {
    const jar = new CookieJar();
    const { uuid } = await wx.requestLoginUuid(jar);
    const qr = await wx.fetchQrcode(uuid);
    const ct = qr.contentType || "";
    const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
    const qrPath = path.join(dataDir(), "qr." + ext);
    fs.writeFileSync(qrPath, qr.buffer);
    writePending({ uuid, createdAt: Date.now(), jar: jar.toJSON() });
    return {
      state: "waiting_scan",
      uuid,
      qrPath,
      qrBytes: qr.buffer.length,
      expiresInSec: Math.round(PENDING_TTL_MS / 1000),
    };
  }

  async function checkLogin(options = {}) {
    const pending = readPending();
    if (!pending) {
      const session = loadSession();
      if (isLoggedIn(session)) return { state: "online", nickName: session.nickName || "" };
      return { state: "no_pending", hint: "还没有待确认的二维码，先调用 action=login" };
    }

    const jar = new CookieJar(pending.jar || []);
    const waitSec = Math.max(0, Math.min(Number(options.waitSec) || 0, 120));
    const deadline = Date.now() + waitSec * 1000;
    let result = { code: 0 };
    for (;;) {
      result = await wx.checkLogin(pending.uuid, jar);
      if (result.code === 200 || result.code === 201 || result.code === 408 || result.code === 400 || result.code === 500) break;
      if (Date.now() >= deadline) break;
      await wx.sleep(1000);
    }
    pending.jar = jar.toJSON();
    writePending(pending);

    if (result.code === 201) return { state: "scanned_wait_confirm", hint: "手机上已扫码，请在手机点确认" };
    if (result.code === 408) {
      // 408 是「本轮 25s 长轮询窗口没人扫码」，不是二维码失效。
      // 真过期只看本地 TTL（微信码约 5 分钟）。
      if (Date.now() - Number(pending.createdAt || 0) >= PENDING_TTL_MS) {
        clearPending();
        return { state: "expired", hint: "二维码已过期（约 5 分钟），重新 action=login" };
      }
      return { state: "waiting_scan", hint: "还没扫码，继续等" };
    }
    if (result.code === 400 || result.code === 500) {
      clearPending();
      return { state: "rejected", hint: "该账号可能不支持网页版登录（code=" + result.code + "）" };
    }
    if (result.code === 200 && result.redirectUri) {
      try {
        return await finishLogin(result.redirectUri, jar);
      } catch (err) {
        writeLastError(err, jar);
        throw err;
      }
    }
    return { state: "waiting_scan", hint: "还没扫码" };
  }

  function openSession() {
    const session = loadSession();
    if (!isLoggedIn(session)) {
      const err = new Error("还没登录：先调用 action=login 拿二维码扫码，再用 action=login_check 确认");
      err.code = "NOT_LOGGED_IN";
      throw err;
    }
    return { session, jar: jarOf(session) };
  }

  async function sendFile(filePath, options = {}) {
    const { session, jar } = openSession();
    const startedAt = Date.now();
    const target = path.resolve(String(filePath || ""));
    if (!fs.existsSync(target)) throw new Error("文件不存在：" + target);
    try {
      const uploaded = await wx.uploadFile(session, jar, target);
      const sent = await wx.sendAppMsg(session, jar, {
        title: uploaded.filename,
        size: uploaded.size,
        mediaId: uploaded.mediaId,
        ext: wx.extOf(uploaded.filename),
        toUserName: options.toUserName,
      });
      persistJar(session, jar);
      saveSession(session);
      const elapsedMs = Date.now() - startedAt;
      recordHistory({
        action: "send_file",
        ok: true,
        fileName: uploaded.filename,
        filePath: target,
        size: uploaded.size,
        chunks: uploaded.chunks,
        msgId: sent.msgId || "",
        elapsedMs,
      });
      return {
        ok: true,
        state: "sent",
        fileName: uploaded.filename,
        size: uploaded.size,
        chunks: uploaded.chunks,
        msgId: sent.msgId || "",
        mediaId: uploaded.mediaId,
        elapsedMs,
      };
    } catch (err) {
      recordHistory({
        action: "send_file",
        ok: false,
        fileName: path.basename(target),
        filePath: target,
        size: fs.existsSync(target) ? fs.statSync(target).size : 0,
        error: String((err && err.message) || err),
        elapsedMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  async function sendText(text) {
    const body = String(text || "");
    if (!body.trim()) throw new Error("text 为空");
    const { session, jar } = openSession();
    const sent = await wx.sendText(session, jar, body);
    persistJar(session, jar);
    saveSession(session);
    recordHistory({ action: "send_text", ok: true, fileName: "（文本）", size: body.length, msgId: sent.msgId || "" });
    return { ok: true, state: "sent", msgId: sent.msgId || "", chars: body.length };
  }

  async function list(options = {}) {
    const { session, jar } = openSession();
    const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
    const sync = await wx.webwxSync(session, jar, session.syncKey);
    if (sync && sync.SyncKey) session.syncKey = sync.SyncKey;
    persistJar(session, jar);
    saveSession(session);
    const fresh = wx.extractFiles(sync && sync.AddMsgList);
    const merged = [];
    const seen = new Set();
    for (const item of fresh.concat(readRecent())) {
      if (!item || !item.msgId || seen.has(item.msgId)) continue;
      seen.add(item.msgId);
      merged.push(item);
    }
    writeRecent(merged);
    const files = merged.slice(0, limit);
    return { ok: true, state: "listed", count: files.length, files };
  }

  async function pull(options = {}) {
    const { session, jar } = openSession();
    let meta = {
      mediaId: options.mediaId || "",
      fileName: options.fileName || "",
      sender: options.sender || "",
    };
    if (options.msgId) {
      const hit = readRecent().find((item) => item.msgId === String(options.msgId));
      if (hit) meta = { mediaId: hit.mediaId, fileName: hit.fileName, sender: hit.from };
    }
    if (!meta.mediaId) throw new Error("需要 mediaId，或先用 action=list 拿到 msgId");
    const buffer = await wx.downloadMedia(session, jar, meta);
    const destDir = options.destDir ? path.resolve(String(options.destDir)) : path.join(dataDir(), "downloads");
    fs.mkdirSync(destDir, { recursive: true });
    const outPath = path.join(destDir, safeName(meta.fileName || "file-" + Date.now()));
    fs.writeFileSync(outPath, buffer);
    return { ok: true, state: "saved", path: outPath, bytes: buffer.length };
  }

  /**
   * 「把刚才那个发我微信」——agent 不知道是哪个。给它一批最近改动的候选，
   * 比让它自己猜路径稳。
   */
  async function recentCandidates(options = {}) {
    const minutes = Math.max(1, Math.min(Number(options.minutes) || 30, 1440));
    const limit = Math.max(1, Math.min(Number(options.limit) || 10, 30));
    const cutoff = Date.now() - minutes * 60000;
    const roots = new Set([process.cwd()]);
    for (const item of readRecent().slice(0, 20)) {
      if (item && item.fileName) {
        // 历史里没有绝对路径，只能借工作目录推断；跳过
      }
    }
    for (const item of readHistorySafe().slice(0, 20)) {
      if (item && item.filePath) {
        try {
          roots.add(path.dirname(item.filePath));
        } catch {
          /* ignore */
        }
      }
    }
    const seen = new Set();
    const out = [];
    for (const root of roots) {
      let entries = [];
      try {
        entries = await fsp.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const full = path.join(root, entry.name);
        if (seen.has(full)) continue;
        const stat = await fsp.stat(full).catch(() => null);
        if (!stat || stat.mtimeMs < cutoff) continue;
        seen.add(full);
        out.push({ path: full, size: stat.size, mtime: new Date(stat.mtimeMs).toISOString() });
      }
    }
    out.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return out.slice(0, limit);
  }

  function logout() {
    clearSession();
    clearPending();
    return { ok: true, state: "logged_out" };
  }

  return { status, login, checkLogin, sendFile, sendText, list, pull, logout, friendlyError, recentCandidates };
}
