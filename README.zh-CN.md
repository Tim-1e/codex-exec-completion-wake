# 命令执行完，自动唤醒原来的 Codex 桌面聊天

[English](README.md)

假设你让 Codex 跑一组测试。测试还在进行时，助手可以先结束这轮对话，你可以切到另一个窗口工作。等测试退出，桌面会把消息送回发起测试的聊天，助手接着读结果。哪条命令值得等，由助手逐条登记。

## 一次测试怎样跑完

1. 助手用 `exec_command` 启动 `npm test`，把 `yield_time_ms` 设短一些。如果测试很快跑完，当轮就能读到结果。
2. 如果命令还在运行，执行器会返回 `session_id`。助手在同一轮调用 `wake_on_exec_completion`，例如传入 `{"session_id":123}`。登记成功就可以结束这一轮。如果命令恰好在登记前退出，工具会直接给出结果 ID，助手当场就能读取。
3. 命令已经退出、原来那一轮也正常结束后，桌面会给原聊天投递一条带结果 ID 的通知。助手在新一轮向同一工具传入 `{"result_id":"<通知里的 ID>"}`，取回状态、退出码和输出末尾 4,000 个 UTF-16 代码单元。命令输出随工具响应返回。

## 接到自己的桌面宿主

完成通知模块只依赖 Node.js 标准库。桌面宿主需要一条可用的原生 app-server 连接，支持 `thread/start.dynamicTools`、命令和对话轮次的事件、队列增删（`thread/queue/add`、`thread/queue/delete`）与聊天记录读取（`thread/read`）。工具调用的分发、RPC 请求与响应的配对由宿主负责。

- **已有匹配的桌面主进程桥接代码**时，将 `exec-completion.cjs` 复制到 `src/updater/external-agents.cjs` 同目录。在宿主源码根目录运行 `git apply --check <补丁路径>/desktop-main.patch`，通过后运行 `git apply <补丁路径>/desktop-main.patch`。打包时把模块放在桥接代码旁边。
- **自行接入其他宿主**时，可直接使用 `native-hooks.cjs` 和 `exec-completion.cjs`。每条本地原生连接各建一个 `createNativeHooks(request, warn)` 实例。发给服务端的是 `hooks.outgoing(message)` 的返回值。收到服务端消息时，先调 `hooks.incoming(message, sendResponse)`，返回 true 就表示消息已处理。两个回调都绑定当前连接。`request(method, params)` 返回解析后 RPC 结果的 Promise，`sendResponse(response)` 把工具响应发回服务端。

启动接好补丁的桌面宿主，再**新建一个本地原生聊天**。工具在创建聊天时注册。旧聊天沿用原有工具。等待记录放在内存里，桌面及其连接需要保持运行。中断轮次、关闭、归档或删除聊天时会清理登记。通过 SSH 跑远端任务时，让 SSH 一直等到远端命令退出。已经脱离 SSH 运行的任务需要另外提供完成信号。

## 怎么验证

用 Node.js 运行两组离线测试：

```sh
node test-exec-completion.cjs
node test-native-hooks.cjs
```

此前在 Windows 桌面版 `26.1111.2228.0`、核心 `0.169.0-alpha.11.1` 的双窗口测试中，两条命令都在原轮结束后退出。原聊天分别在命令退出后 261 毫秒、202 毫秒开始下一轮。另一个窗口一直保持焦点，收到的轮次数为零。要自行验证，可以在新聊天启动一条有限时长的命令并登记，结束本轮后切换到第二个窗口，检查哪个聊天恢复，以及取回的输出是否和命令一致。

上游讨论见[按命令选择退出通知](https://github.com/openai/codex/issues/32188)和[对话轮次结束后唤醒 Codex](https://github.com/openai/codex/issues/51272)。
