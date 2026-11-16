// lib/webwx.js — filehelper.weixin.qq.com 的 webwx 协议客户端（纯 HTTP，无浏览器）
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { newDeviceId } from "./session.js";

export const APP_ID = "wx_webfilehelper";
export const HOST = "filehelper.weixin.qq.com";
export const BASE = "https://" + HOST;
export const LOGIN_BASE = "https://login.weixin.qq.com";
export const CGI = BASE + "/cgi-bin/mmwebwx-bin";

/** 登录后的 cgi 域可能不是 filehelper（redirect_uri 说了算），统一走这里 */
export function cgiOf(session) {
  const base = (session && session.baseUrl) || BASE;
  return String(base).replace(/\/+$/, "") + "/cgi-bin/mmwebwx-bin";
}
export const FILEHELPER_USER = "filehelper";

export const CHUNK_SIZE = 512 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const RATE_DELAY_MS = 1200;

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function request(url, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    jar,
    redirect = "follow",
    timeoutMs = 30000,
  } = opts;
  const h = {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: BASE + "/",
    // 官方前端每个请求都带这个头；缺了会被判 1100（参数错误）
    mmweb_appid: APP_ID,
    ...headers,
  };
  if (jar) {
    const cookieHeader = jar.header();
    if (cookieHeader) h.Cookie = cookieHeader;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: h, body, redirect, signal: controller.signal });
    if (jar && typeof res.headers.getSetCookie === "function") {
      const cookies = res.headers.getSetCookie();
      if (cookies && cookies.length) jar.absorbSetCookie(cookies);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(what + " 返回非 JSON：" + String(text).slice(0, 160));
  }
}

export function baseRequest(session) {
  return {
    Uin: Number(session.wxuin) || 0,
    Sid: session.wxsid || "",
    Skey: session.skey || "",
    DeviceID: session.deviceId || newDeviceId(),
  };
}

/* ------------------------------------------------------------------ 登录 */

export async function requestLoginUuid(jar) {
  const url = LOGIN_BASE + "/jslogin?appid=" + APP_ID + "&fun=new&lang=zh_CN&_=" + Date.now();
  const res = await request(url, { jar, timeoutMs: 20000 });
  const text = await res.text();
  const m = /uuid\s*=\s*"([^"]+)"/.exec(text);
  if (!m) {
    const code = (/code\s*=\s*(\d+)/.exec(text) || [])[1];
    throw new Error("jslogin 未返回 uuid（code=" + (code || "?") + "）：" + text.trim().slice(0, 120));
  }
  return { uuid: m[1], raw: text.trim().slice(0, 200) };
}

export function qrcodeUrl(uuid) {
  return LOGIN_BASE + "/qrcode/" + uuid;
}

export async function fetchQrcode(uuid) {
  const res = await request(qrcodeUrl(uuid), { timeoutMs: 20000 });
  if (!res.ok) throw new Error("二维码下载失败 HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("二维码为空（uuid 可能已失效，重新获取）");
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  return { buffer: buf, contentType };
}

/** code: 200 扫码通过、可换登录凭证 / 201 已扫码待确认 / 408 本轮没人扫 / 400|500 失败 */
export async function checkLogin(uuid, jar, tip = 0) {
  const url =
    LOGIN_BASE +
    "/cgi-bin/mmwebwx-bin/login?loginicon=true&uuid=" + uuid +
    "&tip=" + tip + "&r=" + ~Date.now() + "&_=" + Date.now();
  // 微信这个接口是长轮询：没扫码时会挂 25s 左右才返回，超时必须给够
  const res = await request(url, { jar, timeoutMs: 45000 });
  const text = await res.text();
  const code = Number((/code\s*=\s*(\d+)/.exec(text) || [])[1] || 0);
  const redirectUri = (/redirect_uri\s*=\s*"([^"]+)"/.exec(text) || [])[1] || "";
  return { code, redirectUri, raw: text.trim().slice(0, 300) };
}

/** 扫码确认后用 redirect_uri 换 skey/wxsid/wxuin/pass_ticket，cookie 落进 jar */
export async function completeLogin(redirectUri, jar) {
  let url = redirectUri;
  if (!/[?&]fun=new/.test(url)) url += (url.includes("?") ? "&" : "?") + "fun=new&version=v2";
  // 手动跟跳转：follow 模式下中间那一跳的 Set-Cookie 会被丢掉，票据就不完整了
  let res = await request(url, { jar, redirect: "manual", timeoutMs: 30000 });
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops < 6) {
    url = new URL(res.headers.get("location"), url).toString();
    res = await request(url, { jar, redirect: "manual", timeoutMs: 30000 });
    hops += 1;
  }
  const text = await res.text();
  const pick = (tag) => {
    const m = new RegExp("<" + tag + ">([\\s\\S]*?)<\\/" + tag + ">").exec(text);
    if (!m) return "";
    return m[1]
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .trim();
  };
  const ret = pick("ret");
  if (ret !== "0") {
    const err = new Error("webwxnewloginpage 失败 ret=" + (ret || "?") + "：" + text.slice(0, 200));
    err.rawXml = text;
    throw err;
  }
  const creds = {
    skey: pick("skey"),
    wxsid: pick("wxsid"),
    wxuin: pick("wxuin"),
    passTicket: pick("pass_ticket"),
    xml: text.slice(0, 400),
  };
  const missing = ["skey", "wxsid", "wxuin"].filter((key) => !creds[key]);
  if (missing.length) {
    const err = new Error("webwxnewloginpage 字段缺失：" + missing.join(","));
    err.rawXml = text;
    throw err;
  }
  // 兜底：万一 Set-Cookie 没吃全，用票据里的值补齐（webwx 只认这几个 cookie）
  if (!jar.get("wxuin")) jar.set("wxuin", creds.wxuin);
  if (!jar.get("wxsid")) jar.set("wxsid", creds.wxsid);
  return creds;
}

/* -------------------------------------------------------------- 初始化 */

export async function webwxInit(session, jar, opts = {}) {
  // pass_ticket 原样拼：它本身已是 URL 安全形式，再编码一次会变成 %252B 导致 1101
  // 官方前端用 r=~new Date（负数取反），照抄
  const url =
    cgiOf(session) + "/webwxinit?r=" + ~Date.now() + "&lang=zh_CN&pass_ticket=" +
    (session.passTicket || "");
  const res = await request(url, {
    method: "POST",
    jar,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({ BaseRequest: baseRequest(session) }),
    timeoutMs: opts.timeoutMs || 30000,
  });
  const text = await res.text();
  const json = parseJson(text, "webwxinit");
  const ret = json && json.BaseResponse ? json.BaseResponse.Ret : undefined;
  if (ret !== 0) throw new Error("webwxinit 失败 Ret=" + ret + "（登录态可能已失效）");
  return json;
}

/* ---------------------------------------------------------------- 上传 */

const MIME_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4",
  wav: "audio/wav", amr: "audio/amr", silk: "audio/silk",
  pdf: "application/pdf", zip: "application/zip", rar: "application/x-rar-compressed",
  "7z": "application/x-7z-compressed", txt: "text/plain", md: "text/markdown",
  json: "application/json", html: "text/html", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  apk: "application/vnd.android.package-archive", exe: "application/octet-stream",
};

export function mimeOf(name) {
  const ext = path.extname(String(name || "")).replace(".", "").toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export function extOf(name) {
  return path.extname(String(name || "")).replace(".", "").toLowerCase().slice(0, 8);
}

export function formatBytes(n) {
  const size = Number(n) || 0;
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  if (size < 1024 * 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + " MB";
  return (size / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

/**
 * 分片上传，返回 MediaId（@cdn_ 开头的 attachid）。
 * 每片 512KB，逐片串行并限速 —— 微信对网页版有频控，并发会触发"操作过于频繁"。
 */
export function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * 分片上传，返回 MediaId。字段严格照官方 _webwxuploadmedia：
 * uploadmediarequest = {UploadType, BaseRequest, ClientMediaId, TotalLen, StartPos, DataLen,
 *                       MediaType, FromUserName, ToUserName, FileMd5}
 * 分片信息走独立的 chunks/chunk 字段，不要塞进 uploadmediarequest。
 */
export async function uploadFile(session, jar, filePath, opts = {}) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error("不是文件：" + filePath);
  if (stat.size <= 0) throw new Error("空文件无法发送：" + filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      "文件 " + formatBytes(stat.size) + " 超过上限 " + formatBytes(MAX_FILE_BYTES) + "，请先压缩或分卷"
    );
  }
  const filename = path.basename(filePath);
  const fileMd5 = await md5File(filePath);
  const totalChunks = Math.max(1, Math.ceil(stat.size / CHUNK_SIZE));
  const clientMediaId = String(Date.now()) + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  const dataTicket = jar.get("webwx_data_ticket") || "";
  let mediaId = "";
  let lastResponse = null;
  const handle = await fsp.open(filePath, "r");
  try {
    for (let chunk = 0; chunk < totalChunks; chunk += 1) {
      const start = chunk * CHUNK_SIZE;
      const len = Math.min(CHUNK_SIZE, stat.size - start);
      const buffer = Buffer.alloc(len);
      await handle.read(buffer, 0, len, start);

      const form = new FormData();
      form.append("name", filename);
      form.append("type", mimeOf(filename));
      form.append("lastModifiedDate", new Date(stat.mtimeMs).toString());
      form.append("size", String(len));
      if (totalChunks > 1) {
        form.append("chunks", String(totalChunks));
        form.append("chunk", String(chunk));
      }
      form.append("mediatype", opts.mediaType || "doc");
      form.append(
        "uploadmediarequest",
        JSON.stringify({
          UploadType: 2,
          BaseRequest: baseRequest(session),
          ClientMediaId: clientMediaId,
          TotalLen: stat.size,
          StartPos: 0,
          DataLen: stat.size,
          MediaType: 4,
          FromUserName: session.userName,
          ToUserName: FILEHELPER_USER,
          FileMd5: fileMd5,
        })
      );
      form.append("webwx_data_ticket", dataTicket);
      form.append("pass_ticket", session.passTicket || "");
      // 文件本体必须以 filename 作为表单字段名（官方 v.append("filename", file, name)，itchat 同）
      form.append("filename", new Blob([buffer]), filename);

      const res = await request(cgiOf(session) + "/webwxuploadmedia?f=json&random=" + Math.random().toString(36).slice(2, 6), {
        method: "POST",
        jar,
        body: form,
        timeoutMs: opts.timeoutMs || 180000,
      });
      const text = await res.text();
      const json = parseJson(text, "webwxuploadmedia（第 " + (chunk + 1) + "/" + totalChunks + " 片）");
      const ret = json && json.BaseResponse ? json.BaseResponse.Ret : undefined;
      if (ret !== 0) {
        throw new Error(
          "上传第 " + (chunk + 1) + "/" + totalChunks + " 片失败 Ret=" + ret +
            " " + String(text).slice(0, 160)
        );
      }
      lastResponse = json;
      if (json.MediaId) mediaId = json.MediaId;
      if (chunk < totalChunks - 1) await sleep(RATE_DELAY_MS);
    }
  } finally {
    await handle.close();
  }
  if (!mediaId) {
    const err = new Error("上传完成但没有拿到 MediaId：" + JSON.stringify(lastResponse).slice(0, 400));
    err.rawUpload = lastResponse;
    throw err;
  }
  return { mediaId, filename, size: stat.size, chunks: totalChunks, md5: fileMd5 };
}

/* ---------------------------------------------------------------- 发送 */

export function appMsgContent({ title, size, mediaId, ext }) {
  const esc = (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    "<appmsg mmweb_appid='wx_webfilehelper' sdkver=''>" +
    "<title>" + esc(title) + "</title>" +
    "<des></des><action>default</action><type>6</type>" +
    "<content></content><url></url><lowurl></lowurl>" +
    "<appattach><totallen>" + (Number(size) || 0) + "</totallen>" +
    "<attachid>" + esc(mediaId) + "</attachid>" +
    "<fileext>" + esc(ext || "") + "</fileext></appattach>" +
    "<extinfo></extinfo></appmsg>"
  );
}

export function localId() {
  return String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
}

export async function sendMessage(session, jar, msg, opts = {}) {
  const path = msg.Type === 6 ? "/webwxsendappmsg?fun=async&f=json" : "/webwxsendmsg?lang=zh_CN&f=json";
  const url = cgiOf(session) + path + "&pass_ticket=" + (session.passTicket || "");
  const body = JSON.stringify({ BaseRequest: baseRequest(session), Msg: msg });
  const res = await request(url, {
    method: "POST",
    jar,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body,
    timeoutMs: opts.timeoutMs || 60000,
  });
  const text = await res.text();
  const json = parseJson(text, "webwxsend");
  const ret = json && json.BaseResponse ? json.BaseResponse.Ret : undefined;
  if (ret !== 0) throw new Error("发送失败 Ret=" + ret + (json && json.BaseResponse && json.BaseResponse.ErrMsg ? "：" + json.BaseResponse.ErrMsg : ""));
  return { msgId: json.MsgID, localId: json.LocalID };
}

export async function sendAppMsg(session, jar, params) {
  const id = localId();
  return sendMessage(session, jar, {
    Type: 6,
    Content: appMsgContent(params),
    FromUserName: session.userName,
    ToUserName: params.toUserName || FILEHELPER_USER,
    LocalID: id,
    ClientMsgId: id,
  });
}

export async function sendText(session, jar, text, toUserName = FILEHELPER_USER) {
  const id = localId();
  return sendMessage(session, jar, {
    Type: 1,
    Content: String(text),
    FromUserName: session.userName,
    ToUserName: toUserName,
    LocalID: id,
    ClientMsgId: id,
  });
}

/* ---------------------------------------------------------------- 同步 */

export async function webwxSync(session, jar, syncKey, opts = {}) {
  const url =
    cgiOf(session) + "/webwxsync?sid=" + (session.wxsid || "") +
    "&skey=" + (session.skey || "") +
    "&pass_ticket=" + (session.passTicket || "");
  const body = JSON.stringify({
    BaseRequest: baseRequest(session),
    SyncKey: syncKey || { Count: 0, List: [] },
    rr: ~Date.now(),
  });
  const res = await request(url, {
    method: "POST",
    jar,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body,
    timeoutMs: opts.timeoutMs || 40000,
  });
  const text = await res.text();
  const json = parseJson(text, "webwxsync");
  const ret = json && json.BaseResponse ? json.BaseResponse.Ret : undefined;
  if (ret !== 0) throw new Error("webwxsync 失败 Ret=" + ret + "（登录态可能已失效）");
  return json;
}

export function extractFiles(messages = []) {
  const out = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (Number(msg.MsgType) !== 49) continue;
    const app = msg.AppMsg || {};
    const attach = app.AppAttach || {};
    const type = Number(app.Type);
    if (!(type === 6 || attach.AttachId)) continue;
    out.push({
      msgId: String(msg.MsgId || ""),
      fileName: app.FileName || attach.FileName || app.Title || "unnamed",
      fileSize: Number(app.FileSize || attach.TotalLen || 0),
      mediaId: attach.AttachId || app.MediaId || "",
      extension: attach.FileExt || app.FileExt || "",
      from: msg.FromUserName || "",
      to: msg.ToUserName || "",
      createTime: Number(msg.CreateTime || 0),
    });
  }
  return out;
}

/* ---------------------------------------------------------------- 下载 */

export async function downloadMedia(session, jar, params) {
  const url =
    cgiOf(session) + "/webwxgetmedia?sender=" + encodeURIComponent(params.sender || "") +
    "&mediaid=" + encodeURIComponent(params.mediaId || "") +
    "&filename=" + encodeURIComponent(params.fileName || "") +
    "&webwx_data_ticket=" + encodeURIComponent(jar.get("webwx_data_ticket") || "") +
    "&pass_ticket=" + encodeURIComponent(session.passTicket || "");
  const res = await request(url, { jar, timeoutMs: 180000 });
  if (!res.ok) throw new Error("下载失败 HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("下载到 0 字节");
  return buf;
}
