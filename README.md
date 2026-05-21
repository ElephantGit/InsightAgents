# InsightAgents

**InsightAgents** is a specialized toolkit designed to track, analyze, and visualize the internal behavior of [Opencode](https://opencode.ai) AI agents. It provides a seamless bridge between agent execution and performance analysis, helping developers optimize context usage, tool reliability, and token efficiency.

## 🚀 Features

- **Event Logging**: A dedicated plugin for Opencode agents that captures every interaction, tool call, and token metric in real-time.
- **Visual Dashboard**: A modern React-based interface to analyze session logs.
- **Context Analysis**: Detailed breakdown of context window growth, pinpointing exactly which tool calls or responses are consuming memory.
- **Token Tracking**: Stacked visualization of input, output, and cached tokens.
- **Conversation Reconstruction**: A clean UI to review the agent's thought process, tool executions, and final outputs.
- **Tool Reliability**: Statistics on tool success rates and distribution.

## 📂 Project Structure

```text
InsightAgents/
├── agents/             # Agent configurations and plugins
│   └── opencode/       # Opencode-specific implementation
│       ├── opencode.json         # Agent config with plugin integration
│       └── plugin/               # Logging plugin logic
│           └── opencode-vis-plugin.ts  # JSONL event logger
└── vis/                # Visualization Tool (React + Vite + Tailwind)
    ├── src/            # Dashboard source code
    └── public/         # Static assets
```

## 🛠️ Getting Started

### 1. Capture Agent Logs

The `opencode-vis-plugin` logs agent sessions to JSONL files.

1.  Ensure you have the plugin configured in your `opencode.json`:
    ```json
    {
      "plugin": ["./plugin/opencode-vis-plugin.ts"],
      ...
    }
    ```
2.  Run your Opencode agent.
3.  Session logs will be generated in `.opencode/sessions/session-<timestamp>.jsonl`.

### 2. Launch the Visualization Dashboard

The dashboard is a static web app that parses the generated JSONL files.

1.  Navigate to the `vis` directory:
    ```bash
    cd vis
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
4.  Open the provided URL (usually `http://localhost:5173`) in your browser.

### 3. Analyze Your Session

- Click **"Choose JSONL File"** in the dashboard.
- Select a session file from your `.opencode/sessions/` directory.
- Explore the **Dashboard**, **Conversation**, and **Raw Logs** tabs to gain insights into your agent's performance.

## 📊 Key Metrics Tracked

- **Volume**: Total tokens processed (Input + Output + Cached).
- **Context Growth**: Incremental growth of the context window per step.
- **Cache Efficiency**: Percentage of tokens served from the cache.
- **Tool Performance**: Success/Failure rates of agentic tool calls.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
