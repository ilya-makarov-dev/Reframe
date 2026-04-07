/**
 * Agent Chat — primary UX for creating and modifying designs.
 *
 * Sends messages to Claude API with tool definitions that map
 * to reframe core functions. Agent generates/modifies designs,
 * adds animations, runs audit, exports — all through conversation.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSceneStore } from '../store/scene';
import { useProjectStore } from '../store/project';
import { bridge } from '../mcp/bridge';
import { AGENT_TOOLS, SYSTEM_PROMPT } from '../agent/tools';
import { presets } from '@reframe/core/animation/presets';
import { getTemplateByName } from './TemplateGallery';
import type { INodeAnimation, ITimeline } from '@reframe/core/animation/types';

export interface ChatMessage {
  role: 'user' | 'agent' | 'tool';
  content: string;
  timestamp: number;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('reframe_api_key') ?? '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const {
    activeArtboardId, artboards, graph: graphTop, rootId: rootIdTop,
    importHtml, runAudit, auditIssues, loadDesignMd,
    setTimeline, timeline, exportHtml, exportSvg, exportReact,
    exportAnimatedHtml, exportLottieJson, updateNode, selectedIds, addArtboard,
  } = useSceneStore();
  const ab = artboards.find(a => a.id === activeArtboardId);
  const graph = ab ? ab.graph : graphTop;
  const rootId = ab ? ab.rootId : rootIdTop;

  useEffect(() => {
    messagesRef.current?.scrollTo(0, messagesRef.current.scrollHeight);
  }, [messages]);

  // Build scene context for agent
  const getSceneContext = useCallback(() => {
    if (!graph || !rootId) return '';
    const root = graph.getNode(rootId);
    if (!root) return '';

    const nodes: string[] = [];
    const walk = (id: string, depth: number) => {
      const n = graph.getNode(id);
      if (!n) return;
      const indent = '  '.repeat(depth);
      let line = `${indent}[${n.type}] "${n.name}" ${Math.round(n.width)}x${Math.round(n.height)} at (${Math.round(n.x)},${Math.round(n.y)})`;
      if (n.type === 'TEXT' && n.text) line += ` text="${n.text.slice(0, 40)}"`;
      nodes.push(line);
      for (const cid of n.childIds) walk(cid, depth + 1);
    };
    walk(rootId, 0);

    let ctx = `\n\nCurrent scene: "${root.name}" ${root.width}x${root.height}\nNode tree:\n${nodes.join('\n')}`;

    if (auditIssues.length > 0) {
      ctx += `\n\nAudit issues (${auditIssues.length}):\n${auditIssues.slice(0, 5).map(i => `- [${i.severity}] ${i.rule}: ${i.message}${i.fix?.css ? ` (fix: ${i.fix.css})` : ''}`).join('\n')}`;
    }

    if (timeline) {
      ctx += `\n\nAnimation: ${timeline.animations.length} tracks`;
    }

    if (selectedIds.length > 0) {
      const names = selectedIds.map(id => graph.getNode(id)?.name ?? id);
      ctx += `\n\nSelected: ${names.join(', ')}`;
    }

    return ctx;
  }, [graph, rootId, auditIssues, timeline, selectedIds]);

  // Execute tool call from agent — routes through MCP when connected
  const executeTool = useCallback((name: string, toolInput: any): string | Promise<string> => {
    const mcpConnected = useProjectStore.getState().connected;

    // MCP-routed: produce pipeline (import + audit + export in one call)
    if (mcpConnected && (name === 'create_design' || name === 'modify_design') && toolInput.html) {
      return bridge.callTool('reframe_produce', {
        html: toolInput.html,
        exports: ['html'],
      }).then(res => {
        // Still import locally so canvas updates
        importHtml(toolInput.html);
        const text = res.content[0]?.text ?? '';
        return `Design ${name === 'create_design' ? 'created' : 'updated'} via MCP pipeline.\n${text.slice(0, 500)}`;
      }).catch(() => {
        importHtml(toolInput.html);
        return `Design ${name === 'create_design' ? 'created' : 'updated'} on canvas (MCP fallback).`;
      });
    }

    // MCP-routed: audit (19 rules vs local subset)
    if (mcpConnected && name === 'run_audit') {
      return bridge.callTool('reframe_audit', {}).then(res => {
        runAudit(); // also run local for UI
        return res.content[0]?.text ?? 'Audit complete';
      }).catch(() => {
        runAudit();
        return 'Audit completed (local fallback)';
      });
    }

    // MCP-routed: export
    if (mcpConnected && name === 'export_design') {
      const fmtMap: Record<string, string> = {
        html: 'reframe_export_html', svg: 'reframe_export_svg',
        react: 'reframe_export_react',
      };
      const mcpTool = fmtMap[toolInput.format];
      if (mcpTool) {
        return bridge.callTool(mcpTool, {}).then(res => {
          return res.content[0]?.text ?? `Exported ${toolInput.format}`;
        }).catch(() => `MCP export failed — use local export`);
      }
    }

    // Local execution (direct graph access)
    switch (name) {
      case 'create_design':
      case 'modify_design':
        if (toolInput.html) {
          importHtml(toolInput.html);
          return `Design ${name === 'create_design' ? 'created' : 'updated'} on canvas.`;
        }
        return 'Error: no HTML provided';

      case 'animate_design': {
        if (!toolInput.animations || !graph) return 'Error: no animations or no scene';
        const anims: INodeAnimation[] = [];
        for (const a of toolInput.animations) {
          const preset = presets[a.preset];
          if (!preset) continue;
          const base = preset.create({ duration: a.duration });
          // Find node by name
          let nodeId: string | undefined;
          if (a.nodeName && rootId) {
            nodeId = findNodeByName(graph, rootId, a.nodeName) ?? undefined;
          }
          anims.push({
            nodeId,
            nodeName: a.nodeName,
            name: a.preset,
            keyframes: base.keyframes,
            duration: base.duration,
            delay: a.delay ?? 0,
            direction: base.direction,
            fillMode: base.fillMode ?? 'both',
          });
        }
        const newTimeline: ITimeline = {
          animations: [...(timeline?.animations ?? []), ...anims],
          loop: toolInput.loop ?? false,
        };
        setTimeline(newTimeline);
        return `Added ${anims.length} animation(s). Total: ${newTimeline.animations.length} tracks.`;
      }

      case 'update_node': {
        if (!graph || !rootId || !toolInput.nodeName) return 'Error: no scene or node name';
        const nodeId = findNodeByName(graph, rootId, toolInput.nodeName);
        if (!nodeId) return `Error: node "${toolInput.nodeName}" not found`;
        updateNode(nodeId, toolInput.changes);
        return `Updated "${toolInput.nodeName}"`;
      }

      case 'load_design_system':
        if (toolInput.markdown) {
          loadDesignMd(toolInput.markdown);
          return 'Design system loaded. Brand compliance rules active.';
        }
        return 'Error: no markdown provided';

      case 'run_audit':
        runAudit();
        const issues = useSceneStore.getState().auditIssues;
        if (issues.length === 0) return 'Audit passed — no issues found.';
        return `Audit found ${issues.length} issue(s):\n${issues.map(i => `- [${i.severity}] ${i.rule}: ${i.message}${i.fix?.css ? ` (fix: ${i.fix.css})` : ''}`).join('\n')}`;

      case 'export_design': {
        const format = toolInput.format;
        let content = '';
        let filename = '';
        let mimeType = '';
        if (format === 'html') { content = exportHtml(); filename = 'design.html'; mimeType = 'text/html'; }
        else if (format === 'svg') { content = exportSvg(); filename = 'design.svg'; mimeType = 'image/svg+xml'; }
        else if (format === 'react') { content = exportReact(); filename = 'Design.tsx'; mimeType = 'text/plain'; }
        else if (format === 'animated_html') { content = exportAnimatedHtml(); filename = 'animated.html'; mimeType = 'text/html'; }
        else if (format === 'lottie') { content = exportLottieJson(); filename = 'animation.json'; mimeType = 'application/json'; }
        else return `Unknown format: ${format}`;

        if (!content) return `Nothing to export (no scene${format.includes('anim') || format === 'lottie' ? ' or no timeline' : ''})`;
        download(filename, content, mimeType);
        return `Exported ${format} → ${filename} (${(content.length / 1024).toFixed(1)} KB)`;
      }

      case 'use_template': {
        const template = getTemplateByName(toolInput.templateName);
        if (!template) return `Unknown template: "${toolInput.templateName}". Available: Tech Banner, Social Card, Story, Card, Ad Banner, Dashboard`;
        importHtml(template.html);
        return `Loaded template "${template.name}" (${template.width}×${template.height})`;
      }

      case 'new_artboard': {
        addArtboard(toolInput.name, toolInput.width, toolInput.height);
        return `Created artboard "${toolInput.name}" (${toolInput.width}×${toolInput.height}). Now active — ${artboards.length + 1} total artboards.`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }, [graph, rootId, importHtml, updateNode, runAudit, loadDesignMd, setTimeline, timeline, exportHtml, exportSvg, exportReact, exportAnimatedHtml, exportLottieJson, addArtboard, artboards]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || busy) return;
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'agent', content: 'Set your Anthropic API key first (click Key in header)', timestamp: Date.now() }]);
      return;
    }

    const userMsg: ChatMessage = { role: 'user', content: input.trim(), timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setBusy(true);

    try {
      const sceneContext = getSceneContext();
      const systemMsg = SYSTEM_PROMPT + sceneContext;

      // Build conversation for API
      const apiMessages = [...messages, userMsg]
        .filter(m => m.role !== 'tool')
        .map(m => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content,
        }));

      let response = await callApi(apiKey, systemMsg, apiMessages, AGENT_TOOLS);

      // Process response — handle tool use loop
      let iterations = 0;
      while (iterations < 5) {
        iterations++;
        let hasToolUse = false;
        const toolResults: any[] = [];

        for (const block of response.content) {
          if (block.type === 'text' && block.text) {
            setMessages(prev => [...prev, { role: 'agent', content: block.text, timestamp: Date.now() }]);
          }
          if (block.type === 'tool_use') {
            hasToolUse = true;
            const resultOrPromise = executeTool(block.name, block.input);
            const result = typeof resultOrPromise === 'string' ? resultOrPromise : await resultOrPromise;
            setMessages(prev => [...prev, { role: 'tool', content: `${block.name}: ${result}`, timestamp: Date.now() }]);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        if (!hasToolUse || response.stop_reason !== 'tool_use') break;

        // Continue conversation with tool results
        apiMessages.push({ role: 'assistant' as const, content: response.content });
        apiMessages.push({ role: 'user' as const, content: toolResults as any });
        response = await callApi(apiKey, systemMsg, apiMessages, AGENT_TOOLS);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'agent', content: `Error: ${err.message}`, timestamp: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, apiKey, messages, getSceneContext, executeTool]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span>Agent</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setShowKeyInput(!showKeyInput)}>
            {apiKey ? 'Key' : '! Key'}
          </button>
          {messages.length > 0 && (
            <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setMessages([])}>
              Clear
            </button>
          )}
        </div>
      </div>

      {showKeyInput && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <input
            className="prop-input" type="password"
            placeholder="Anthropic API Key (sk-ant-...)"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); localStorage.setItem('reframe_api_key', e.target.value); }}
            style={{ width: '100%', fontSize: 11 }}
          />
        </div>
      )}

      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '8px 0', lineHeight: 1.6 }}>
            Describe what you want to design. The agent will create it on canvas.
            <br /><br />
            Try: "Create a dark tech startup banner 1920x1080 with a headline, subtitle, and CTA button"
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {busy && <div className="chat-message chat-message--agent" style={{ opacity: 0.5 }}>Thinking...</div>}
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input" rows={1} value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={graph ? 'Describe changes...' : 'Describe a design to create...'}
          disabled={busy}
        />
        <button className="chat-send" onClick={handleSend} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

async function callApi(apiKey: string, system: string, messages: any[], tools: any[]): Promise<any> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system,
      messages,
      tools,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }

  return response.json();
}

function findNodeByName(graph: any, nodeId: string, name: string): string | null {
  const node = graph.getNode(nodeId);
  if (!node) return null;
  if (node.name === name) return node.id;
  for (const childId of node.childIds) {
    const found = findNodeByName(graph, childId, name);
    if (found) return found;
  }
  return null;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
