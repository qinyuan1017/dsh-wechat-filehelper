// test/plugin.test.mjs — 端到端（mock HTTP）：走 apply() 注册 → 登录状态机 → 发文件/发文本/收件/下载
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-plugin-"));
process.env.DSH_WECHAT_FH_DIR = dataDir;

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

const J = (obj, headers) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json", ...(headers || {}) } });

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/webwxuploadmedia")) return J({ BaseResponse: { Ret: 0 }, MediaId: "@cdn_uploaded" });
  if (u.includes("/webwxsendappmsg")) return J({ BaseResponse: { Ret: 0 }, MsgID: "m-app", LocalID: "l1" });
  if (u.includes("/webwxsendmsg")) return J({ BaseResponse: { Ret: 0 }, MsgID: "m-txt", LocalID: "l2" });
  if (u.includes("/jslogin")) return new Response('window.QRLogin.code = 200; window.QRLogin.uuid = "UUID123==";', { status: 200 });
  if (u.includes("/qrcode/")) return new Response(Buffer.from("PNGDATA"), { status: 200 });
  if (u.includes("/cgi-bin/mmwebwx-bin/login")) {
    const forced = globalThis.__pollCode;
    if (forced && forced !== 200) return new Response("window.code=" + forced + ";", { status: 200 });
    return new Response('window.code=200;window.redirect_uri="https://filehelper.weixin.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=T&uuid=UUID123==";', { status: 200 });
  }
  if (u.includes("/webwxnewloginpage")) {
    return new Response(
      "<error><ret>0</ret><skey>@sk</skey><wxsid>S1</wxsid><wxuin>42</wxuin><pass_ticket>PT</pass_ticket></error>",
      { status: 200, headers: { "Set-Cookie": "webwx_data_ticket=DT; Path=/", "Content-Type": "text/plain" } }
    );
  }
  if (u.includes("/webwxinit")) {
    return J({ BaseResponse: { Ret: 0 }, User: { UserName: "@me", NickName: "月咒" }, SyncKey: { Count: 1, List: [{ Key: 1, Val: 1 }] } });
  }
  if (u.includes("/webwxsync")) {
    return J({
      BaseResponse: { Ret: 0 },
      SyncKey: { Count: 1, List: [{ Key: 1, Val: 2 }] },
      AddMsgList: [{
        MsgId: "77",
        MsgType: 49,
        FromUserName: "@me",
        ToUserName: "@filehelper",
        AppMsg: { Type: 6, FileName: "报告.pdf", FileSize: 7, AppAttach: { AttachId: "@cdn_x", FileExt: "pdf", TotalLen: 7 } },
      }],
    });
  }
  if (u.includes("/webwxgetmedia")) return new Response(Buffer.from("PDFDATA"), { status: 200 });
  return J({ BaseResponse: { Ret: 0 } });
};

const mod = await import("../index.js");
const registered = {};
const promptSections = [];
const routes = [];
const ctx = {
  inject: (deps, factory) => {
    if (deps.includes("tools")) {
      factory({ tools: { register: (def) => { registered[def.name] = def; return () => {}; } } });
    }
    if (deps.includes("systemPrompt")) {
      factory({ systemPrompt: { section: (spec) => { promptSections.push(spec); return () => {}; } } });
    }
    if (deps.includes("webServer")) {
      factory({ webServer: { register: (spec) => { routes.push(spec); return () => {}; }, getOrigin: () => "http://127.0.0.1" } });
    }
  },
};
mod.apply(ctx, {});

const tool = registered.wechat_filehelper;

await check("插件导出 name/inject/apply 且注册了 wechat_filehelper", () => {
  assert.equal(mod.name, "dsh-wechat-filehelper");
  assert.deepEqual(mod.inject, ["tools"]);
  assert.equal(typeof mod.apply, "function");
  assert.ok(tool);
  assert.match(tool.description, /filePath/);
  assert.ok(tool.parameters.action);
});

await check("系统提示里带「发我微信」触发词", () => {
  assert.equal(promptSections.length, 1);
  const text = promptSections[0].text;
  assert.match(text, /发我微信/);
  assert.match(text, /wechat_filehelper/);
  assert.match(text, /不要反问/);
});

await check("注册了 /wechat-filehelper/api 前缀路由", () => {
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, "prefix");
  assert.equal(routes[0].path, "/wechat-filehelper/api");
  assert.equal(typeof routes[0].handler, "function");
});

await check("未登录时 status=offline 且 send_file 明确报未登录", async () => {
  const s = await tool.execute({ action: "status" });
  assert.equal(s.state, "offline");
  const bad = await tool.execute({ action: "send_file", filePath: "x" });
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /还没登录/);
});

await check("action=login 落二维码文件并返回等待扫码", async () => {
  const out = await tool.execute({ action: "login" });
  assert.equal(out.state, "waiting_scan");
  assert.ok(fs.existsSync(out.qrPath));
  assert.equal(fs.readFileSync(out.qrPath, "utf8"), "PNGDATA");
  assert.equal(out.uuid, "UUID123==");
});

await check("408 只是本轮没人扫，不算过期也不清 pending", async () => {
  globalThis.__pollCode = 408;
  const out = await tool.execute({ action: "login_check" });
  globalThis.__pollCode = 200;
  assert.equal(out.state, "waiting_scan");
  assert.equal(out.ok, false);
  const s = await tool.execute({ action: "status" });
  assert.equal(s.info.hasPendingQr, true);
});

await check("action=login_check 完成换票并落盘 session.json", async () => {
  const out = await tool.execute({ action: "login_check" });
  assert.equal(out.state, "online");
  assert.equal(out.nickName, "月咒");
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "session.json"), "utf8"));
  assert.equal(saved.skey, "@sk");
  assert.equal(saved.wxuin, "42");
  assert.equal(saved.userName, "@me");
  assert.equal(saved.deviceId.startsWith("e"), true);
  assert.ok(saved.cookie.some((c) => c.name === "webwx_data_ticket" && c.value === "DT"));
});

await check("action=status 显示已登录", async () => {
  const out = await tool.execute({ action: "status" });
  assert.equal(out.state, "online");
  assert.match(out.summary, /月咒/);
});

await check("action=send_file 完整走完上传+发送", async () => {
  const file = path.join(dataDir, "hello.txt");
  fs.writeFileSync(file, "hello wechat");
  const out = await tool.execute({ action: "send_file", filePath: file });
  assert.equal(out.ok, true);
  assert.equal(out.state, "sent");
  assert.equal(out.fileName, "hello.txt");
  assert.equal(out.size, 12);
  assert.equal(out.chunks, 1);
  assert.match(out.summary, /已发到微信：hello\.txt/);
});

await check("action=send_text 发送文字", async () => {
  const out = await tool.execute({ action: "send_text", text: "来自 agent 的一句话" });
  assert.equal(out.ok, true);
  assert.match(out.summary, /13 字/);
});

await check("action=list 解析出手机来的文件", async () => {
  const out = await tool.execute({ action: "list", limit: 5 });
  assert.equal(out.ok, true);
  assert.equal(out.count, 1);
  assert.equal(out.files[0].fileName, "报告.pdf");
  assert.equal(out.files[0].msgId, "77");
});

await check("action=pull 按 msgId 下载到指定目录", async () => {
  const dest = path.join(dataDir, "out");
  const out = await tool.execute({ action: "pull", msgId: "77", destDir: dest });
  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(out.path, "utf8"), "PDFDATA");
  assert.equal(path.basename(out.path), "报告.pdf");
});

await check("非法 action 被挡住", async () => {
  const out = await tool.execute({ action: "explode" });
  assert.equal(out.ok, false);
  assert.equal(out.state, "bad_action");
});

await check("action=logout 清掉本地登录态", async () => {
  const out = await tool.execute({ action: "logout" });
  assert.equal(out.state, "logged_out");
  assert.equal(fs.existsSync(path.join(dataDir, "session.json")), false);
  const s = await tool.execute({ action: "status" });
  assert.equal(s.state, "offline");
});

console.log("");
console.log(pass + " 过 / " + fail + " 不过");
try {
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch {
  /* ignore */
}
if (fail > 0) process.exitCode = 1;
