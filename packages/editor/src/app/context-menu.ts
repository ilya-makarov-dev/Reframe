/**
 * Context Menu — right-click menu on canvas nodes.
 *
 * Actions: copy, paste, duplicate, delete, group/ungroup,
 * bring to front/send to back, create component, lock/unlock, hide/show.
 */

import type { Editor } from '@open-pencil/core';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  separator?: boolean;
  disabled?: boolean;
}

export function getContextMenuItems(editor: Editor, nodeId: string | null): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const hasSelection = editor.state.selectedIds.size > 0;

  if (nodeId) {
    const node = editor.getNode(nodeId);

    items.push({ label: 'Cut', shortcut: '\u2318X', action: 'cut', disabled: !hasSelection });
    items.push({ label: 'Copy', shortcut: '\u2318C', action: 'copy', disabled: !hasSelection });
    items.push({ label: 'Paste', shortcut: '\u2318V', action: 'paste' });
    items.push({ label: 'Duplicate', shortcut: '\u2318D', action: 'duplicate', disabled: !hasSelection });
    items.push({ label: 'Delete', shortcut: 'Del', action: 'delete', disabled: !hasSelection, separator: true });

    items.push({ label: 'Bring to Front', shortcut: ']', action: 'bring-front', disabled: !hasSelection });
    items.push({ label: 'Send to Back', shortcut: '[', action: 'send-back', disabled: !hasSelection, separator: true });

    items.push({ label: 'Group', shortcut: '\u2318G', action: 'group', disabled: editor.state.selectedIds.size < 2 });
    items.push({ label: 'Ungroup', shortcut: '\u21E7\u2318G', action: 'ungroup', disabled: !node || node.type !== 'GROUP' });
    items.push({ label: 'Create Component', shortcut: '\u2325\u2318K', action: 'create-component', disabled: !hasSelection, separator: true });

    items.push({ label: node?.visible === false ? 'Show' : 'Hide', shortcut: '\u21E7\u2318H', action: 'toggle-visibility' });
    items.push({ label: node?.locked ? 'Unlock' : 'Lock', shortcut: '\u21E7\u2318L', action: 'toggle-lock' });
  } else {
    items.push({ label: 'Paste', shortcut: '\u2318V', action: 'paste' });
    items.push({ label: 'Select All', shortcut: '\u2318A', action: 'select-all' });
  }

  return items;
}

/** Render context menu as positioned HTML. */
export function renderContextMenu(x: number, y: number, items: ContextMenuItem[]): string {
  let html = `<div id="context-menu" style="
    position:fixed;left:${x}px;top:${y}px;z-index:1000;
    background:#1a1a1a;border:1px solid #333;border-radius:8px;
    padding:4px;min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,0.5);
    font-size:12px;
  ">`;

  // Use a <style> block instead of inline onmouseover (CSP-safe)
  html += `<style>
    #context-menu button:not([disabled]):hover { background: #2563eb !important; }
  </style>`;

  for (const item of items) {
    if (item.separator) {
      html += `<div style="height:1px;background:#333;margin:4px 0;"></div>`;
    }
    html += `<button data-action="${item.action}" style="
      display:flex;justify-content:space-between;align-items:center;
      width:100%;padding:6px 12px;border:none;border-radius:4px;
      background:transparent;color:${item.disabled ? '#555' : '#e5e5e5'};
      cursor:${item.disabled ? 'default' : 'pointer'};text-align:left;
      font-family:inherit;font-size:12px;
      ${item.disabled ? 'pointer-events:none;' : ''}
    ">
      <span>${item.label}</span>
      ${item.shortcut ? `<span style="color:#666;font-size:11px;">${item.shortcut}</span>` : ''}
    </button>`;
  }

  html += `</div>`;
  return html;
}

/** Execute a context menu action. */
export function executeContextAction(action: string, editor: Editor): void {
  switch (action) {
    case 'cut':
      editor.duplicateSelected(); // TODO: proper cut = copy + delete
      editor.deleteSelected();
      break;
    case 'copy': {
      // Copy selected nodes as JSON to clipboard
      const nodes = editor.getSelectedNodes?.() || [];
      if (nodes.length > 0) {
        try { navigator.clipboard.writeText(JSON.stringify(nodes.map((n: any) => n.id))); } catch {}
      }
      break;
    }
    case 'paste':
      // Paste is complex — needs clipboard read + node creation
      // For now, duplicate as placeholder
      editor.duplicateSelected();
      break;
    case 'duplicate':
      editor.duplicateSelected();
      break;
    case 'delete':
      editor.deleteSelected();
      break;
    case 'group':
      editor.groupSelected();
      break;
    case 'ungroup':
      editor.ungroupSelected();
      break;
    case 'bring-front':
      editor.bringToFront();
      break;
    case 'send-back':
      editor.sendToBack();
      break;
    case 'create-component':
      editor.createComponentFromSelection();
      break;
    case 'toggle-visibility':
      editor.toggleVisibility();
      break;
    case 'toggle-lock':
      editor.toggleLock();
      break;
    case 'select-all':
      editor.selectAll();
      break;
  }
  editor.requestRender();
}
