# dsh-wechat-filehelper

把「微信文件传输助手」接进 DeepSeek Harness：**agent 一句话把文件发到你手机微信，全程不用打开浏览器。**

网页版（filehelper.weixin.qq.com）在这里只当一次性的认证入口 —— 扫一次码，登录态落盘，之后全部走 HTTP 接口（`webwxinit / webwxuploadmedia / webwxsendappmsg / webwxsync / webwxgetmedia`）。

仓库：https://github.com/qinyuan1017/dsh-wechat-filehelper

## 安装

```bash
# 1) 仓库已在 ~/my-repos/dsh-wechat-filehelper
# 2) 加进 desktop profile
cd ~/.dsh/profiles/desktop
# package.json: dependencies 里加 "dsh-wechat-filehelper": "file:C:/Users/亭檐霜/my-repos/dsh-wechat-filehelper"
#               dsh.profile.bundles 里加 "dsh-wechat-filehelper"
pnpm install
```

插件自带 `cordis.patch.yml`，装载时自动 insert 条目 `wechat-filehelper`。

## agent 怎么用

一个工具 `wechat_filehelper`，按 action 分派：

| action | 参数 | 作用 |
|---|---|---|
| `status` | — | 看是否已登录、登录时间、二维码是否待扫 |
| `login` | — | 生成二维码（返回 `qrPath`，把图片给用户扫） |
| `login_check` | `waitSec` | 查扫码结果，`waitSec` 最多等 120 秒；成功即落盘 |
| `send_file` | `filePath` | **把本地文件发到微信** |
| `send_text` | `text` | 发一段文字 |
| `list` | `limit` | 列手机发来的文件（含 `msgId`） |
| `pull` | `msgId` / `mediaId` / `destDir` | 把文件下载到本地 |
| `logout` | — | 清除本地登录态 |

典型对话：

```
用户：把这个报表发我微信
agent → wechat_filehelper({ action: "send_file", filePath: "E:/out/report.xlsx" })
        → 已发到微信：report.xlsx（18 字节，1 片，1204 ms）
```

首次需要扫码：

```
agent → wechat_filehelper({ action: "login" })        // 返回 qrPath，把图展示给用户
用户：扫好了
agent → wechat_filehelper({ action: "login_check", waitSec: 30 })
        → 登录成功：月咒
```

## 数据与登录态

- 目录：`~/.dsh/data/dsh-wechat-filehelper/`（可用 `DSH_WECHAT_FH_DIR` 覆盖）
  - `session.json` —— cookie + skey/wxsid/wxuin/pass_ticket/deviceId/UserName（权限 600）
  - `pending.json` —— 待扫码 uuid（5 分钟过期）
  - `qr.png` —— 最近一次二维码
  - `recent.json` —— 最近收到的文件索引
  - `downloads/` —— `pull` 默认落盘目录
- `deviceId` 固定复用，不每次重生成（微信风控）。

## 协议要点（为什么要这么做）

| 环节 | 接口 | 关键参数 |
|---|---|---|
| 取 uuid | `login.weixin.qq.com/jslogin` | `appid=wx_webfilehelper` |
| 二维码 | `login.weixin.qq.com/qrcode/{uuid}` | 图片直出，`uuid` 原样拼（含 `==`） |
| 轮询 | `login.weixin.qq.com/cgi-bin/mmwebwx-bin/login` | `loginicon=true&uuid=…`，code 200/201/408 |
| 换票 | `webwxnewloginpage?fun=new&version=v2` | 返回 XML，Set-Cookie 带 `webwx_data_ticket` |
| 初始化 | `webwxinit` | 拿自己的 `UserName` 和 `SyncKey` |
| 上传 | `webwxuploadmedia?f=json` | 512KB 分片，`uploadmediarequest` 带 TotalChunks/Chunk/FileSize |
| 发送 | `webwxsendappmsg` | `Type=6`，Content 是 appmsg XML，`attachid=MediaId` |
| 收件 | `webwxsync` | `AddMsgList` 里 `MsgType=49` + `AppMsg.Type=6` |
| 下载 | `webwxgetmedia` | `mediaid & sender & filename`，会 302 到 CDN |

## 限制

- 单文件上限 **100MB**（`MAX_FILE_BYTES`），超限直接报错不硬发。
- 上传分片串行、每片间隔 1.2s：这是给微信频控留的余量，并发会触发「操作过于频繁」。
- 目标固定为「文件传输助手」（即用户自己）；w x.qq.com 那套给别人的通道早已停服。
- 部分账号不支持网页版登录（扫码后 code=400/500），这时只能换号。
- 登录态会过期；`send_*` 报 1101/1102 时重新 `login`。

## 设置页

DSH 设置页里有一块「微信文件传输助手」分区（`settings.section`，order 32）：

- **登录状态**：绿点/灰点、昵称、登录时间；未登录时可直接点「扫码登录」
- **二维码**：点一下就在面板里出图，2 秒轮询一次，扫完自动切到已登录
- **发送历史**：时间 / 文件名 / 大小 / 分片数 / 耗时 / 成功失败，失败带原因，最多留 200 条

界面走 `lib/client.js`（`src/*.js` 拼接产物），数据走 `POST /wechat-filehelper/api`：
`state / qr / qr_check / history / send_file / candidates / logout`。

## 让 agent 主动发送

插件会往系统提示里注入一段规则（`systemPrompt.section`），用户说
「发我微信」「发到文件传输助手」「传到我手机」时，agent 直接调 `wechat_filehelper`，
不反问、不只回一句“好的”。

不知道文件是哪个的时候，工具会返回最近 30 分钟改动过的文件候选清单
（`action=candidates`），让模型自己挑，而不是回头问用户。

## 测试

```bash
node test/protocol.test.mjs   # 17 项：协议层，纯 mock，不联网
node test/plugin.test.mjs     # 14 项：apply() 注册 → 提示词 → 登录状态机 → 发文件/文本/收件
node test/rpc.test.mjs        # 10 项：设置页接口（含回环鉴权、未知 op、历史倒序）
node test/client.test.mjs     #  5 项：客户端 bundle 在假 loader 下执行并注册 settings.section
```

合计 46 项。

协议层覆盖：cookie jar、appmsg XML 转义、官方格式的 uploadmediarequest、512KB 分片与
chunks/chunk 字段、空文件/超限拒绝、sync 消息解析、getmedia 下载、init Ret=1101 失效路径。

## 真机验证记录（2026-11-16）

| 项 | 结果 |
|---|---|
| 扫码登录 | 成功，会话域 `szfilehelper.weixin.qq.com`，昵称「6」 |
| 发 171B 文本文件 | sent，msgId 返回，719 ms |
| 发 1.2MB 文件（3 片） | sent，3.65 s |
| 发文本消息 | sent |

踩过的四个坑（都写进了代码注释）：

1. 二维码是 **JPEG** 不是 PNG —— 按 `Content-Type` 定扩展名。
2. 扫码轮询的 `code=408` 是「本轮 25s 没人扫」，不是二维码过期。
3. 所有请求必须带 `mmweb_appid: wx_webfilehelper`，否则 `webwxinit` 直接 1100。
4. 上传的文件本体字段名是 **`filename`**（不是 `file`），且 `uploadmediarequest` 里是
   `ClientMediaId/TotalLen/DataLen/MediaType/FromUserName/ToUserName/FileMd5`，
   分片信息走独立的 `chunks`/`chunk` —— 写成 `FileSize/Filename` 会得到 `Ret=1` 或空 MediaId。
