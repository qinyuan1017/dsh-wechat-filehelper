// index.js — dsh-wechat-filehelper 插件入口
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createClient } from "./lib/filehelper.js";
import { createRpcHandler, ROUTE } from "./lib/rpc.js";

export const name = "dsh-wechat-filehelper";
export const inject = ["tools"];

const ACTIONS = ["status", "login", "login_check", "send_file", "send_text", "list", "pull", "history", "candidates", "logout"];

const TOOL_DESCRIPTION = [
  "把本地文件或文本发到用户自己的微信（微信文件传输助手 filehelper.weixin.qq.com），全程纯 HTTP，不需要打开浏览器。",
  "触发场景：用户说「发我微信」「发到文件传输助手」「传到我手机」「把报告发我微信」等，直接调用本工具，不要反问、不要只回一句“好的”。",
  "用法：",
  "1) 发文件：action=send_file + filePath。不确定文件是哪个时先 action=candidates 拿最近改动清单再选，不要问用户“是哪个文件”。",
  "2) 发文字：action=send_text + text。",
  "3) 首次使用：action=login 生成二维码，把返回的 qrPath 图片给用户扫；再 action=login_check（可带 waitSec ≤120）直到 state=online。",
  "4) 收件：action=list 拿 msgId，action=pull 下载到本地。",
  "5) action=history 看最近发送记录；action=status 看登录状态；action=logout 清除登录态。",
  "限制：单文件 100MB；上传串行限速（大文件会慢但稳）；目标固定为「文件传输助手」也就是用户自己。",
].join("\n");

const PROMPT_SECTION = [
  "## 微信文件传输助手（wechat_filehelper）",
  "当用户说「发我微信」「发到文件传输助手」「传到我手机/手机上」「把 X 发我微信」时，",
  "直接调用 wechat_filehelper，不要反问、不要只回复“我帮你发”而不调用。",
  "- 用户明确给了文件路径 → 直接 send_file。",
  "- 用户说“刚才那个/这个报告”但没给路径 → 先调 wechat_filehelper(action=\"candidates\") 拿最近改动文件清单，选最匹配的一个发送，仍不确定时才问一句。",
  "- 发送成功后只回报：文件名、大小、耗时。不要复述文件内容，不要贴路径堆砌。",
  "- 工具返回 state=offline 或提示未登录 → 调 action=login，把 qrPath 展示给用户扫码。",
  "- 单文件上限 100MB；超过就直接说明，不要尝试分卷上传。",
].join("\n");

function render(args, value) {
  if (!value) return "wechat_filehelper: 无返回";
  return value.summary || JSON.stringify(value);
}

export function apply(ctx, config = {}) {
  const client = createClient();
  const disposers = [];

  ctx.inject(["tools"], (sctx) => {
    const dispose = sctx.tools.register(
      defineTool({
        name: "wechat_filehelper",
        description: TOOL_DESCRIPTION,
        parameters: {
          action: {
            type: "string",
            description:
              "必填。send_file 发文件 / send_text 发文字 / candidates 列最近改动文件 / status 查状态 / login 出二维码 / login_check 查扫码 / list 列收件 / pull 下载 / history 发送记录 / logout 退出登录",
          },
          filePath: { type: "string", description: "send_file 用：本地文件绝对路径或相对当前工作目录的路径" },
          text: { type: "string", description: "send_text 用：要发送的文字" },
          msgId: { type: "string", description: "pull 用：list 返回的 msgId" },
          mediaId: { type: "string", description: "pull 用：直传 mediaId" },
          fileName: { type: "string", description: "pull 用：配合 mediaId 的文件名" },
          sender: { type: "string", description: "pull 用：配合 mediaId 的发送方" },
          destDir: { type: "string", description: "pull 用：下载目录" },
          limit: { type: "number", description: "list/history 用：条数，默认 10，最大 50" },
          waitSec: { type: "number", description: "login_check 用：等待秒数，默认 0，最大 120" },
          minutes: { type: "number", description: "candidates 用：回溯分钟数，默认 30" },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: true,
            properties: {
              ok: { type: "boolean" },
              state: { type: "string" },
              summary: { type: "string" },
              qrPath: { type: "string" },
              uuid: { type: "string" },
              expiresInSec: { type: "number" },
              nickName: { type: "string" },
              fileName: { type: "string" },
              size: { type: "number" },
              chunks: { type: "number" },
              msgId: { type: "string" },
              path: { type: "string" },
              files: { type: "array" },
              history: { type: "array" },
              info: { type: "object" },
            },
          },
          render,
        },
        async execute(args) {
          const action = String((args && args.action) || "").trim();
          if (!ACTIONS.includes(action)) {
            return { ok: false, state: "bad_action", summary: "action 不合法，可选：" + ACTIONS.join(" / ") };
          }
          try {
            if (action === "status") {
              const info = client.status();
              const summary = info.loggedIn
                ? "已登录：" + (info.nickName || info.userName)
                : "未登录，需要 action=login 扫码";
              return { ok: true, state: info.loggedIn ? "online" : "offline", summary, info };
            }
            if (action === "login") {
              const out = await client.login();
              return {
                ok: true,
                state: out.state,
                summary: "二维码已生成：" + out.qrPath + "（给用户扫，约 " + out.expiresInSec + " 秒有效），扫完调 action=login_check",
                qrPath: out.qrPath,
                uuid: out.uuid,
                expiresInSec: out.expiresInSec,
              };
            }
            if (action === "login_check") {
              const out = await client.checkLogin({ waitSec: args && args.waitSec });
              const map = {
                online: "登录成功：" + (out.nickName || ""),
                waiting_scan: "还没扫码，继续等",
                scanned_wait_confirm: "已扫码，等手机点确认",
                expired: "二维码过期，重新 action=login",
                rejected: out.hint || "登录被拒",
                no_pending: out.hint || "没有待确认的二维码",
              };
              return { ok: out.state === "online", state: out.state, summary: map[out.state] || out.state, nickName: out.nickName };
            }
            if (action === "send_file") {
              if (!args || !args.filePath) {
                const files = await client.recentCandidates({ minutes: args && args.minutes });
                const summary = files.length
                  ? "没给 filePath。最近改动的文件：" + files.map((f) => f.path).join("、") + "（选一个重新调用 send_file）"
                  : "没给 filePath，也没有找到最近改动的文件";
                return { ok: false, state: "need_path", summary, files };
              }
              const out = await client.sendFile(args.filePath);
              return {
                ok: true,
                state: out.state,
                summary: "已发到微信：" + out.fileName + "（" + out.size + " 字节，" + out.chunks + " 片，" + out.elapsedMs + " ms）",
                fileName: out.fileName,
                size: out.size,
                chunks: out.chunks,
                msgId: out.msgId,
              };
            }
            if (action === "send_text") {
              const out = await client.sendText(args && args.text);
              return { ok: true, state: out.state, summary: "已发文字到微信：" + out.chars + " 字", msgId: out.msgId };
            }
            if (action === "candidates") {
              const files = await client.recentCandidates({ minutes: args && args.minutes, limit: args && args.limit });
              return {
                ok: true,
                state: "listed",
                summary: files.length ? "最近改动的文件：" + files.map((f) => f.path).join("、") : "最近没有改动的文件",
                files,
              };
            }
            if (action === "list") {
              const out = await client.list({ limit: args && args.limit });
              const summary = out.count
                ? "最近 " + out.count + " 个文件：" + out.files.map((f) => f.fileName).join("、")
                : "没有收到文件";
              return { ok: true, state: out.state, summary, count: out.count, files: out.files };
            }
            if (action === "pull") {
              const out = await client.pull({
                msgId: args && args.msgId,
                mediaId: args && args.mediaId,
                fileName: args && args.fileName,
                sender: args && args.sender,
                destDir: args && args.destDir,
              });
              return { ok: true, state: out.state, summary: "已保存：" + out.path + "（" + out.bytes + " 字节）", path: out.path };
            }
            if (action === "history") {
              const { readHistory } = await import("./lib/history.js");
              const limit = Math.max(1, Math.min(Number(args && args.limit) || 10, 50));
              const history = readHistory().slice(0, limit);
              const okCount = history.filter((item) => item.ok).length;
              return {
                ok: true,
                state: "listed",
                summary: "最近 " + history.length + " 条发送记录，成功 " + okCount + " 条",
                history,
              };
            }
            const out = client.logout();
            return { ok: true, state: out.state, summary: "已退出登录，本地登录态已清除" };
          } catch (err) {
            return { ok: false, state: (err && err.code) || "error", summary: "失败：" + client.friendlyError(err) };
          }
        },
      })
    );
    if (typeof dispose === "function") disposers.push(dispose);
  });

  ctx.inject(["systemPrompt"], (sctx) => {
    try {
      const dispose = sctx.systemPrompt.section({ name: "wechat-filehelper", order: 520, text: PROMPT_SECTION });
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (err) {
      // 宿主没有 systemPrompt.section 时静默跳过，工具仍然可用
    }
  });

  ctx.inject(["webServer"], (c) => {
    const webServer = c && c.webServer;
    if (!webServer || typeof webServer.register !== "function") return;
    const dispose = webServer.register({ kind: "prefix", path: ROUTE, handler: createRpcHandler(client) });
    if (typeof dispose === "function") disposers.push(dispose);
  });

  const effect = (ctx && ctx.effect) || null;
  if (typeof effect === "function") {
    effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
    });
  }
}

export default { name, inject, apply };
