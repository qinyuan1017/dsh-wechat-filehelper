// test/rpc.test.mjs — 设置页接口：状态 / 历史 / 二维码 / 鉴权
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-rpc-"));
process.env.DSH_WECHAT_FH_DIR = dataDir;

const { createRpcHandler } = await import("../lib/rpc.js");
const { recordHistory, readHistory } = await import("../lib/history.js");

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass += 1;
    console.log("PASS " + label);
  } catch (err) {
    fail += 1;
    console.log("FAIL " + label + " :: " + ((err && err.message) || err));
  }
}

const qrFile = path.join(dataDir, "qr.jpg");
fs.writeFileSync(qrFile, Buffer.from("JPEGDATA"));

const fakeClient = {
  status: () => ({ loggedIn: true, nickName: "6", userName: "@me", savedAt: "2026-11-16T16:20:38.280Z", hasPendingQr: false, pendingExpiresInSec: 0, dataDir }),
  login: async () => ({ state: "waiting_scan", uuid: "U1==", qrPath: qrFile, qrBytes: 8, expiresInSec: 300 }),
  checkLogin: async () => ({ state: "online", nickName: "6" }),
  logout: () => ({ ok: true, state: "logged_out" }),
  sendFile: async (p) => ({ ok: true, state: "sent", fileName: path.basename(p), size: 3, chunks: 1, msgId: "m1", elapsedMs: 10 }),
  recentCandidates: async () => [{ path: "C:/x/a.txt", size: 10, mtime: "2026-11-16T16:00:00.000Z" }],
};
const handler = createRpcHandler(fakeClient);

function mkReq(body, opts = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = opts.method || "POST";
  req.url = opts.url || "/wechat-filehelper/api";
  req.headers = { host: opts.host || "127.0.0.1:50244" };
  return req;
}
function mkRes() {
  return {
    status: 0,
    body: "",
    writeHead(status) { this.status = status; },
    end(chunk) { this.body = String(chunk || ""); },
  };
}
async function rpc(op, payload, opts) {
  const res = mkRes();
  await handler(mkReq({ op, payload }, opts), res);
  return { status: res.status, json: JSON.parse(res.body || "{}") };
}

await check("POST op=state 返回登录状态", async () => {
  const r = await rpc("state");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.nickName, "6");
});

await check("POST op=qr 返回可用的 dataUrl", async () => {
  const r = await rpc("qr");
  assert.equal(r.json.ok, true);
  assert.match(r.json.data.dataUrl, /^data:image\/jpeg;base64,/);
  assert.ok(r.json.data.expiresInSec > 0);
});

await check("POST op=qr_check 返回 online", async () => {
  const r = await rpc("qr_check", { waitSec: 0 });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.state, "online");
});

await check("POST op=history 返回记录", async () => {
  recordHistory({ action: "send_file", ok: true, fileName: "a.txt", size: 12, chunks: 1, msgId: "m1", elapsedMs: 9 });
  recordHistory({ action: "send_file", ok: false, fileName: "b.txt", size: 0, error: "boom" });
  const r = await rpc("history", { limit: 5 });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.history.length, 2);
  assert.equal(r.json.data.history[0].fileName, "b.txt");
  assert.equal(r.json.data.history[0].ok, false);
  assert.equal(r.json.data.history[1].ok, true);
});

await check("history 按时间倒序且失败带 error", () => {
  const list = readHistory();
  assert.equal(list.length, 2);
  assert.equal(list[0].error, "boom");
});

await check("未知 op 返回 400", async () => {
  const r = await rpc("nope");
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /未知 op/);
});

await check("非回环 host 一律 403", async () => {
  const r = await rpc("state", {}, { host: "evil.example.com" });
  assert.equal(r.status, 403);
  assert.equal(r.json.ok, false);
});

await check("GET ?op=state 也能读", async () => {
  const res = mkRes();
  await handler(mkReq(undefined, { method: "GET", url: "/wechat-filehelper/api?op=state" }), res);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).data.nickName, "6");
});

await check("op=send_file 转发到 client", async () => {
  const r = await rpc("send_file", { filePath: "C:/tmp/a.txt" });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.fileName, "a.txt");
});

await check("op=candidates 返回候选清单", async () => {
  const r = await rpc("candidates", {});
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.files.length, 1);
});

console.log("");
console.log(pass + " 过 / " + fail + " 不过");
try {
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* ignore */
}
if (fail > 0) process.exitCode = 1;
