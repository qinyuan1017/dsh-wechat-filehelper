// test/protocol.test.mjs — 离线 mock 验证协议层（不联网、不需要扫码）
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as wx from "../lib/webwx.js";
import { CookieJar } from "../lib/session.js";

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
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u.includes("/webwxuploadmedia")) return J({ BaseResponse: { Ret: 0 }, MediaId: "@cdn_test" });
  if (u.includes("/webwxsendappmsg")) return J({ BaseResponse: { Ret: 0 }, MsgID: "msg-1", LocalID: "loc-1" });
  if (u.includes("/webwxsendmsg")) return J({ BaseResponse: { Ret: 0 }, MsgID: "txt-1", LocalID: "loc-2" });
  if (u.includes("/jslogin")) {
    return new Response('window.QRLogin.code = 200; window.QRLogin.uuid = "QRUUID==";', { status: 200 });
  }
  if (u.includes("/qrcode/")) {
    return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200 });
  }
  if (u.includes("/cgi-bin/mmwebwx-bin/login")) {
    return new Response('window.code=200;window.redirect_uri="https://filehelper.weixin.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=T1&uuid=QRUUID==";', { status: 200 });
  }
  if (u.includes("/webwxnewloginpage")) {
    const xml =
      "<error><ret>0</ret><message></message><skey>@crypt_skey</skey><wxsid>SID123</wxsid><wxuin>777</wxuin><pass_ticket>PT%2Bx</pass_ticket><isgrayscale>1</isgrayscale></error>";
    return new Response(xml, {
      status: 200,
      headers: { "Set-Cookie": "webwx_data_ticket=DT123; Path=/; Domain=filehelper.weixin.qq.com", "Content-Type": "text/plain" },
    });
  }
  if (u.includes("/webwxinit")) {
    return J({
      BaseResponse: { Ret: 0 },
      User: { UserName: "@me-self", NickName: "月咒" },
      SyncKey: { Count: 1, List: [{ Key: 1, Val: 100 }] },
    });
  }
  if (u.includes("/webwxsync")) {
    return J({
      BaseResponse: { Ret: 0 },
      SyncKey: { Count: 1, List: [{ Key: 1, Val: 200 }] },
      AddMsgList: [
        {
          MsgId: "9001",
          MsgType: 49,
          FromUserName: "@me-self",
          ToUserName: "@filehelper",
          AppMsg: {
            Type: 6,
            FileName: "报告.pdf",
            FileSize: 12345,
            AppAttach: { AttachId: "@cdn_file", FileExt: "pdf", TotalLen: 12345 },
          },
        },
        { MsgId: "9002", MsgType: 1, Content: "你好" },
      ],
    });
  }
  if (u.includes("/webwxgetmedia")) {
    return new Response(Buffer.from("PDFDATA"), { status: 200 });
  }
  return J({ BaseResponse: { Ret: 0 } });
};

const session = {
  wxuin: "777",
  wxsid: "SID123",
  skey: "@crypt_skey",
  deviceId: "e123456789012345",
  passTicket: "PTX1",
  userName: "@me-self",
  syncKey: { Count: 1, List: [{ Key: 1, Val: 100 }] },
};
const jar = new CookieJar([{ name: "webwx_data_ticket", value: "DT123" }]);

await check("CookieJar 吸收 Set-Cookie 并拼接 header", () => {
  const j = new CookieJar();
  j.absorbSetCookie(["a=1; Path=/", "b=2; Path=/; HttpOnly"]);
  assert.equal(j.get("a"), "1");
  assert.equal(j.get("b"), "2");
  assert.equal(j.header(), "a=1; b=2");
  assert.deepEqual(j.toJSON(), [{ name: "a", value: "1" }, { name: "b", value: "2" }]);
});

await check("appMsgContent 拼出 type=6 + attachid + totallen", () => {
  const xml = wx.appMsgContent({ title: "报告.pdf", size: 12345, mediaId: "@cdn_file", ext: "pdf" });
  assert.match(xml, /<appmsg /);
  assert.match(xml, /<type>6<\/type>/);
  assert.match(xml, /<attachid>@cdn_file<\/attachid>/);
  assert.match(xml, /<totallen>12345<\/totallen>/);
  assert.match(xml, /<fileext>pdf<\/fileext>/);
});

await check("appMsgContent 转义文件名里的尖括号", () => {
  const xml = wx.appMsgContent({ title: "a<b>c.pdf", size: 1, mediaId: "@m", ext: "pdf" });
  assert.match(xml, /a&lt;b&gt;c\.pdf/);
});

await check("extractFiles 只挑 MsgType=49 的附件消息", () => {
  const files = wx.extractFiles([
    { MsgId: "1", MsgType: 49, AppMsg: { Type: 6, FileName: "a.pdf", FileSize: 10, AppAttach: { AttachId: "@c1", FileExt: "pdf", TotalLen: 10 } }, FromUserName: "@me" },
    { MsgId: "2", MsgType: 1, Content: "hi" },
    { MsgId: "3", MsgType: 49, AppMsg: { Type: 5, Title: "链接" } },
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, "a.pdf");
  assert.equal(files[0].mediaId, "@c1");
  assert.equal(files[0].fileSize, 10);
});

await check("mimeOf / extOf / formatBytes", () => {
  assert.equal(wx.mimeOf("a.PDF"), "application/pdf");
  assert.equal(wx.mimeOf("noext"), "application/octet-stream");
  assert.equal(wx.extOf("a.tar.gz"), "gz");
  assert.equal(wx.formatBytes(512), "512 B");
  assert.equal(wx.formatBytes(2048), "2.0 KB");
  assert.equal(wx.formatBytes(5 * 1024 * 1024), "5.00 MB");
});

await check("baseRequest 用 number Uin + deviceId", () => {
  const br = wx.baseRequest(session);
  assert.equal(br.Uin, 777);
  assert.equal(br.Sid, "SID123");
  assert.equal(br.Skey, "@crypt_skey");
  assert.equal(br.DeviceID, "e123456789012345");
});

await check("requestLoginUuid 解析 uuid", async () => {
  const j = new CookieJar();
  const out = await wx.requestLoginUuid(j);
  assert.equal(out.uuid, "QRUUID==");
});

await check("checkLogin 解析 code=200 + redirect_uri", async () => {
  const out = await wx.checkLogin("QRUUID==", new CookieJar());
  assert.equal(out.code, 200);
  assert.match(out.redirectUri, /webwxnewloginpage\?ticket=T1/);
});

await check("completeLogin 换出 skey/wxsid/wxuin/pass_ticket 并吃下 cookie", async () => {
  const j = new CookieJar();
  const creds = await wx.completeLogin("https://filehelper.weixin.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=T1&uuid=QRUUID==", j);
  assert.equal(creds.skey, "@crypt_skey");
  assert.equal(creds.wxsid, "SID123");
  assert.equal(creds.wxuin, "777");
  assert.equal(creds.passTicket, "PT%2Bx");
  assert.equal(j.get("webwx_data_ticket"), "DT123");
});

await check("webwxInit 返回 User.UserName 与 SyncKey", async () => {
  const out = await wx.webwxInit(session, jar);
  assert.equal(out.User.UserName, "@me-self");
  assert.equal(out.SyncKey.Count, 1);
});

await check("uploadFile 按 512KB 分片且每片带 uploadmediarequest", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"));
  const file = path.join(dir, "blob.bin");
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024)); // 正好 2 片（512KB × 2）
  calls.length = 0;
  const out = await wx.uploadFile(session, jar, file);
  assert.equal(out.chunks, 2);
  assert.equal(out.mediaId, "@cdn_test");
  const uploads = calls.filter((c) => c.url.includes("/webwxuploadmedia"));
  assert.equal(uploads.length, 2);
  const firstMeta = JSON.parse(uploads[0].init.body.get("uploadmediarequest"));
  assert.equal(firstMeta.UploadType, 2);
  assert.equal(firstMeta.TotalLen, 1024 * 1024);
  assert.equal(firstMeta.DataLen, 1024 * 1024);
  assert.equal(firstMeta.MediaType, 4);
  assert.equal(firstMeta.ToUserName, "filehelper");
  assert.equal(firstMeta.FromUserName, "@me-self");
  assert.match(firstMeta.FileMd5, /^[0-9a-f]{32}$/);
  assert.ok(firstMeta.ClientMediaId);
  assert.equal(uploads[0].init.body.get("chunks"), "2");
  assert.equal(uploads[0].init.body.get("chunk"), "0");
  assert.equal(uploads[1].init.body.get("chunk"), "1");
  const fileField = uploads[0].init.body.get("filename");
  assert.equal(typeof fileField, "object");
  assert.equal(fileField.name, "blob.bin");
  assert.equal(uploads[0].init.body.get("name"), "blob.bin");
  assert.equal(uploads[0].init.body.get("size"), String(512 * 1024));
  assert.equal(uploads[0].init.body.get("mediatype"), "doc");
  assert.equal(uploads[0].init.body.get("webwx_data_ticket"), "DT123");
  fs.rmSync(dir, { recursive: true, force: true });
});

await check("uploadFile 拒绝空文件与超限文件", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"));
  const empty = path.join(dir, "empty.bin");
  fs.writeFileSync(empty, Buffer.alloc(0));
  let err1 = null;
  try {
    await wx.uploadFile(session, jar, empty);
  } catch (e) {
    err1 = e;
  }
  assert.ok(err1 && /空文件/.test(err1.message));

  const big = path.join(dir, "big.bin");
  const fd = fs.openSync(big, "w");
  fs.ftruncateSync(fd, wx.MAX_FILE_BYTES + 1);
  fs.closeSync(fd);
  let err2 = null;
  try {
    await wx.uploadFile(session, jar, big);
  } catch (e) {
    err2 = e;
  }
  assert.ok(err2 && /超过上限/.test(err2.message));
  fs.rmSync(dir, { recursive: true, force: true });
});

await check("sendAppMsg 发出 Type=6 且 From/To 正确", async () => {
  calls.length = 0;
  const out = await wx.sendAppMsg(session, jar, { title: "a.pdf", size: 10, mediaId: "@c1", ext: "pdf" });
  assert.equal(out.msgId, "msg-1");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.Msg.Type, 6);
  assert.equal(body.Msg.FromUserName, "@me-self");
  assert.equal(body.Msg.ToUserName, "filehelper");
  assert.match(body.Msg.Content, /<attachid>@c1<\/attachid>/);
  assert.equal(body.BaseRequest.Skey, "@crypt_skey");
});

await check("sendText 发出 Type=1 且带 pass_ticket", async () => {
  calls.length = 0;
  const out = await wx.sendText(session, jar, "你好");
  assert.equal(out.msgId, "txt-1");
  assert.match(calls[0].url, /pass_ticket=PTX1/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.Msg.Type, 1);
  assert.equal(body.Msg.Content, "你好");
});

await check("webwxSync 带回 AddMsgList 与新的 SyncKey", async () => {
  const out = await wx.webwxSync(session, jar, session.syncKey);
  assert.equal(out.SyncKey.List[0].Val, 200);
  const files = wx.extractFiles(out.AddMsgList);
  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, "报告.pdf");
});

await check("downloadMedia 拿到字节", async () => {
  const buf = await wx.downloadMedia(session, jar, { mediaId: "@c1", fileName: "a.pdf", sender: "@me" });
  assert.equal(buf.toString(), "PDFDATA");
});

await check("webwxinit Ret!=0 抛错（登录态失效路径）", async () => {
  const backup = globalThis.fetch;
  globalThis.fetch = async () => J({ BaseResponse: { Ret: 1101 } });
  let err = null;
  try {
    await wx.webwxInit(session, jar);
  } catch (e) {
    err = e;
  }
  globalThis.fetch = backup;
  assert.ok(err && /1101/.test(err.message));
});

console.log("");
console.log(pass + " 过 / " + fail + " 不过");
if (fail > 0) process.exitCode = 1;
