# 传声筒 · Codex Communication Panel

让 Codex 负责规划和执行，由单独选择的模型组织面向用户的中文回复。设置界面使用 MCP Apps 组件，支持它的宿主可以在侧栏中打开，切换服务商、模型和开关，查看发送给模型的固定提示词。

每次调用只发送当前问题的必要部分、已核实事实和待确认事项。沟通模型只返回文字，没有读取项目文件或执行命令的工具。Codex 仍负责核对事实并提交最终回复。自动使用依靠项目指令；桌面的进度提示由客户端显示。

## 安装

需要 Node.js 20 或更新版本、npm、Python 3 和支持本地 MCP 的 Codex 客户端。

```sh
git clone https://github.com/enjoymoon-busdriver/codex-communication-panel.git
cd codex-communication-panel
npm ci --prefix backend
codex mcp add forge_communication -- node "$PWD/backend/server.mjs"
```

在希望启用的项目的 `AGENTS.md` 加入下面一段，再打开一个 Codex 聊天。

> 主会话向我解释工作、汇报结果或询问决定时，默认用 forge_communication 的 compose_reply 工具组织中文回复。只提供当前问题、已核实事实和待确认点。保留数字和限定条件。不要转发完整聊天、原始项目材料或密钥。核对工具返回的事实后采用其措辞。关闭时直接回答。工具不可用时直接说明。本规则只用于主会话与我的工作沟通。

## 侧栏界面

界面使用 MCP Apps 的 `ui://` 资源，并通过 OpenAI 的全局和会话入口扩展声明侧栏入口。支持这些扩展的宿主负责展示组件和入口。普通本地 stdio MCP 注册可提供工具；能否在你的客户端固定到左侧栏，还取决于它是否支持入口和插件注册。

面板提供服务商、模型、开关和真实固定提示词。聊天不会被保存成一份可在面板中回看的历史。模型调用由 MCP 工具执行。

参考 [OpenAI 官方侧栏规范](https://developers.openai.com/plugins/build/extensions#sidebar-apps)、[插件注册说明](https://developers.openai.com/plugins/build/plugins) 和 [官方 UI 示例](https://github.com/openai/openai-apps-sdk-examples)。

## 设置服务商密钥

在仓库目录执行 `python3 backend/set-key.py go`，按提示输入密钥。DeepSeek 使用 `deepseek`，通用兼容接口使用 `custom`（先在组件中保存地址）。密钥输入隐藏，组件只显示已配置状态。

源码附带构建好的组件。需要更新界面时运行 `npm ci --prefix panel` 和 `npm run build --prefix panel`。运行 `npm test --prefix backend` 检查后端。可选的 Streamable HTTP 方式为 `npm run start:http --prefix backend`，默认只在本机回环地址提供 MCP 协议。

## 服务商与密钥

- **OpenCode Go** 使用订阅工作区的服务账户密钥。独立服务账户可以在同一份订阅额度下区分不同客户端的用量。不同模型的可用性取决于工作区权限及区域设置。
- **DeepSeek** 使用 DeepSeek 平台的 API 密钥，由该平台计费。
- **OpenAI 兼容服务** 使用你填写的 Base URL、模型 ID 和该服务商的密钥，请求使用 Chat Completions 格式。服务商需要实际支持此接口。

密钥保存在当前用户的数据目录。页面只返回是否已经配置密钥。默认目录是 `~/.forge-delegate`；可以用 `CODEX_COMMUNICATION_HOME` 给面板和 MCP 指定同一个目录。程序会把选中的密钥发给对应服务商进行认证。

## 来源

直接调用参考了 MIT 许可项目 [Forge Delegate](https://github.com/MuhamadBarzani/forge-delegate) 的 `ask_model` 和 `callDirect`。分工可对照 OpenAI 的 [Chat-Supervisor](https://github.com/openai/openai-realtime-agents#agentic-pattern-1-chat-supervisor)；中文表达原则参考了 [renhua](https://github.com/RiAnBee/renhua)。本项目是独立的社区适配，使用 MIT 许可。
