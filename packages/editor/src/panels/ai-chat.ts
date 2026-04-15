/**
 * AI Chat Panel — prompt input and conversation history.
 *
 * The AI generates designs via MCP tools:
 * - User types prompt → sends to MCP → reframe_compile → SceneGraph → canvas
 * - History shows past prompts and results
 * - Quick actions: "Rebrand to Stripe", "Add hero section", "Export as React"
 */

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** If assistant generated a scene, link to it. */
  sceneId?: string;
  /** Status: pending, done, error. */
  status?: 'pending' | 'done' | 'error';
}

export interface AIChatPanelData {
  messages: AIChatMessage[];
  isGenerating: boolean;
  currentPrompt: string;
}

/** Render the AI chat panel as HTML string. */
export function renderAIChatPanel(data: AIChatPanelData): string {
  let html = '';

  // Quick actions (when empty)
  if (data.messages.length === 0) {
    html += `<div style="padding:16px 0;">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:10px;">Quick start:</div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${quickAction('Build a SaaS landing page', 'build-landing')}
        ${quickAction('Design a dashboard', 'build-dashboard')}
        ${quickAction('Create a product page', 'build-product')}
        ${quickAction('Rebrand current design', 'rebrand')}
      </div>
    </div>`;
  }

  // Messages
  for (const msg of data.messages) {
    const isUser = msg.role === 'user';
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    html += `<div style="
      padding:8px 10px;margin:4px 0;border-radius:6px;
      background:${isUser ? 'var(--bg-2)' : 'transparent'};
      border:${isUser ? 'none' : '1px solid var(--border)'};
    ">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:10px;font-weight:600;color:${isUser ? 'var(--accent)' : 'var(--success)'};">
          ${isUser ? 'You' : 'AI'}
        </span>
        <span style="font-size:10px;color:var(--text-3);">${time}</span>
      </div>
      <div style="font-size:12px;color:var(--text-1);line-height:1.5;">
        ${escHtml(msg.content)}
      </div>
      ${msg.status === 'pending' ? '<div style="margin-top:6px;font-size:11px;color:var(--accent);">Generating...</div>' : ''}
      ${msg.status === 'error' ? '<div style="margin-top:6px;font-size:11px;color:var(--error);">Failed</div>' : ''}
      ${msg.sceneId ? `<div style="margin-top:6px;"><button data-load-scene="${msg.sceneId}" style="
        padding:3px 8px;border-radius:4px;border:1px solid var(--border);
        background:var(--bg-2);color:var(--text-2);font-size:10px;cursor:pointer;font-family:inherit;
      ">Load on canvas</button></div>` : ''}
    </div>`;
  }

  // Generating indicator
  if (data.isGenerating) {
    html += `<div style="padding:8px 10px;text-align:center;">
      <span style="font-size:11px;color:var(--accent);">AI is working...</span>
    </div>`;
  }

  return html;
}

function quickAction(label: string, action: string): string {
  return `<button data-ai-quick="${action}" style="
    padding:8px 10px;border-radius:5px;border:1px solid var(--border);
    background:var(--bg-2);color:var(--text-2);cursor:pointer;
    font-family:inherit;font-size:12px;text-align:left;transition:all 0.1s;
  " onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--text-1)'"
     onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-2)'">
    ${label}
  </button>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
