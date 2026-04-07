/**
 * MCP Connector Panel — connect reframe MCP server to any AI client.
 *
 * Shows connection status, config copy, quick-start prompt.
 * No built-in AI — user works from Claude Code/Desktop/any MCP client.
 */

import { useCallback, useState } from 'react';

const MCP_CONFIG = {
  mcpServers: {
    reframe: {
      command: 'npx',
      args: ['-y', '@reframe/mcp'],
    },
  },
};

const MCP_CONFIG_LOCAL = {
  mcpServers: {
    reframe: {
      command: 'node',
      args: ['packages/mcp/dist/mcp/src/index.js'],
    },
  },
};

const QUICK_PROMPT = `Use reframe MCP tools. Pipeline: reframe_design (extract brand) → reframe_compile (content + sizes → scenes) → reframe_inspect (audit) → reframe_edit (fix) → reframe_export (output).`;

export function McpPanel() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  return (
    <div className="mcp-panel">
      <div className="mcp-panel__header">
        <span className="mcp-panel__title">MCP Server</span>
        <span className="mcp-panel__version">6 tools · v2.0</span>
      </div>

      <div className="mcp-panel__body">
        <div className="mcp-panel__section">
          <div className="mcp-panel__label">Claude Desktop / Windsurf / Cursor</div>
          <div className="mcp-panel__desc">
            Add to config and restart client
          </div>
          <div className="mcp-panel__actions">
            <button
              className="mcp-panel__btn"
              onClick={() => copyToClipboard(JSON.stringify(MCP_CONFIG, null, 2), 'npx')}
            >
              {copied === 'npx' ? 'Copied!' : 'Copy config (npx)'}
            </button>
            <button
              className="mcp-panel__btn mcp-panel__btn--secondary"
              onClick={() => copyToClipboard(JSON.stringify(MCP_CONFIG_LOCAL, null, 2), 'local')}
            >
              {copied === 'local' ? 'Copied!' : 'Copy config (local)'}
            </button>
          </div>
        </div>

        <div className="mcp-panel__section">
          <div className="mcp-panel__label">Claude Code</div>
          <div className="mcp-panel__code">
            claude mcp add reframe npx -y @reframe/mcp
          </div>
          <button
            className="mcp-panel__btn mcp-panel__btn--secondary"
            onClick={() => copyToClipboard('claude mcp add reframe npx -y @reframe/mcp', 'cli')}
          >
            {copied === 'cli' ? 'Copied!' : 'Copy command'}
          </button>
        </div>

        <div className="mcp-panel__section">
          <div className="mcp-panel__label">Quick start prompt</div>
          <div className="mcp-panel__code">{QUICK_PROMPT}</div>
          <button
            className="mcp-panel__btn mcp-panel__btn--secondary"
            onClick={() => copyToClipboard(QUICK_PROMPT, 'prompt')}
          >
            {copied === 'prompt' ? 'Copied!' : 'Copy prompt'}
          </button>
        </div>

        <div className="mcp-panel__tools">
          <div className="mcp-panel__label">6 tools</div>
          <div className="mcp-panel__tool-grid">
            {TOOLS.map(t => (
              <div key={t.name} className="mcp-panel__tool" title={t.desc}>
                <span className="mcp-panel__tool-cat">{t.cat}</span>
                <span className="mcp-panel__tool-name">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const TOOLS = [
  { name: 'reframe_design', cat: '01', desc: 'Extract brand from HTML → DESIGN.md, generate AI prompts' },
  { name: 'reframe_compile', cat: '02', desc: 'Content + DESIGN.md + sizes → N INode scenes, or HTML import' },
  { name: 'reframe_edit', cat: '03', desc: 'INode ops: create, add, update, delete, clone, resize, tokens' },
  { name: 'reframe_inspect', cat: '04', desc: 'Tree + 19-rule audit + assertions + diff — agent feedback loop' },
  { name: 'reframe_export', cat: '05', desc: 'Scene → html / svg / png / react / animated / lottie' },
  { name: 'reframe_project', cat: '06', desc: 'Persistence: init, open, save, load, list' },
];
