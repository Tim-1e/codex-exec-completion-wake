# Wake a Codex desktop chat when a command exits

[简体中文](README.zh-CN.md)

A long build can keep running after the assistant has finished its turn. This patch lets a desktop host wake the chat that launched the build, even while the user is working in another window. The assistant chooses which command should wake it.

## A build from start to finish

1. The assistant starts a finite command such as `npm test` with `exec_command` and a short `yield_time_ms`. If the command finishes immediately, the assistant already has its result.
2. If the executor returns a running session, the assistant calls `wake_on_exec_completion` in the same turn with, for example, `{"session_id":123}`. Once registration succeeds, the assistant can finish its turn. If the command already exited before registration, the tool gives it the result ID to read immediately.
3. Once the command exits and its original turn finishes normally, the host queues a notice in that chat. The notice carries a result ID. On the next turn the assistant calls the same tool with `{"result_id":"<ID from notice>"}` to retrieve the status, exit code and the last 4,000 UTF-16 code units of recorded output. Output stays in the tool response.

## Integrate with a desktop host

The completion module uses the Node.js standard library. The host needs a running native app-server connection with support for `thread/start.dynamicTools`, command and turn events, `thread/queue/add`, `thread/queue/delete` and `thread/read`. The host routes tool calls and correlates RPC requests with their responses.

- **For a host with the matching main-process bridge**, copy `exec-completion.cjs` next to `src/updater/external-agents.cjs`. From the host source root, run `git apply --check <path-to>/desktop-main.patch`, then `git apply <path-to>/desktop-main.patch`. Include the module beside that bridge in the packaged application.
- **For another host**, use `native-hooks.cjs` with `exec-completion.cjs`. Create one `createNativeHooks(request, warn)` per local native connection. Forward `hooks.outgoing(message)` to the server. Before normal incoming dispatch, call `hooks.incoming(message, sendResponse)` and stop dispatch if it returns true. Bind both callbacks to that same connection. `request(method, params)` returns a promise for the decoded RPC result. `sendResponse(response)` writes the tool response back to the server.

Start the patched host and **create a new local native chat**. Registration happens at chat creation. Existing chats keep their original tools. Pending registrations live in memory and require an active desktop connection. Interrupting the turn or closing, archiving or deleting the chat clears registrations. For an SSH job, keep SSH attached until the remote command exits. A detached job needs its own completion signal.

## Verification

Run the offline checks with Node.js:

```sh
node test-exec-completion.cjs
node test-native-hooks.cjs
```

In a previous Windows desktop test (Desktop `26.1111.2228.0`, core `0.169.0-alpha.11.1`), two commands finished after their original turns ended. The originating chat started its next turn 261 ms and 202 ms after exit. A second window kept focus and received zero turns. To reproduce, start a finite command in a fresh chat, register the session, end the turn, and focus a second window. Check which chat resumes and whether the retrieved output matches the command.

Related upstream discussions: [opt-in completion events](https://github.com/openai/codex/issues/32188) and [resuming a chat after turn end](https://github.com/openai/codex/issues/51272).
