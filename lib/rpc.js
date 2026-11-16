// lib/rpc.js — 设置页与命令行共用的 HTTP 接口：POST /wechat-filehelper/api {op, payload}
import os from "node:os";

const ROUTE = "/wechat-filehelper/api";
const MAX_BODY = 256 * 1024;

function loopbackOnly(req) {
  const host = String(req?.headers?.host ?? "").toLowerCase();
  const name = host.replace(/:\d+$/, "");
  if (!name) return false;
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name === "::1";
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function createRpcHandler(client) {
  return async function handler(req, res) {
    if (!loopbackOnly(req)) {
      send(res, 403, { ok: false, error: "只允许本机访问" });
      return;
    }
    try {
      let op = "";
      let payload = {};
      if (String(req.method || "GET").toUpperCase() === "POST") {
        const body = await readJson(req);
        op = String(body.op || "");
        payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      } else {
        const url = new URL(String(req.url || ROUTE), "http://127.0.0.1");
        op = String(url.searchParams.get("op") || "");
      }

      if (op === "state") {
        send(res, 200, { ok: true, data: client.status() });
        return;
      }
      if (op === "history") {
        const { readHistory } = await import("./history.js");
        const limit = Math.max(1, Math.min(Number(payload.limit) || 30, 200));
        send(res, 200, { ok: true, data: { history: readHistory().slice(0, limit) } });
        return;
      }
      if (op === "qr") {
        const out = await client.login();
        const fs = await import("node:fs");
        const buffer = fs.readFileSync(out.qrPath);
        const ext = out.qrPath.endsWith(".jpg") ? "jpeg" : out.qrPath.endsWith(".webp") ? "webp" : "png";
        send(res, 200, {
          ok: true,
          data: {
            state: out.state,
            uuid: out.uuid,
            expiresInSec: out.expiresInSec,
            dataUrl: "data:image/" + ext + ";base64," + buffer.toString("base64"),
          },
        });
        return;
      }
      if (op === "qr_check") {
        const out = await client.checkLogin({ waitSec: payload.waitSec || 0 });
        send(res, 200, { ok: out.state === "online", data: out });
        return;
      }
      if (op === "logout") {
        send(res, 200, { ok: true, data: client.logout() });
        return;
      }
      if (op === "send_file") {
        const out = await client.sendFile(payload.filePath);
        send(res, 200, { ok: true, data: out });
        return;
      }
      if (op === "candidates") {
        const files = await client.recentCandidates(payload);
        send(res, 200, { ok: true, data: { files } });
        return;
      }
      send(res, 400, { ok: false, error: "未知 op：" + op });
    } catch (err) {
      send(res, 500, { ok: false, error: String((err && err.message) || err) });
    }
  };
}

export { ROUTE };
