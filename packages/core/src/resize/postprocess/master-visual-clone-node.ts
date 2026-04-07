/** Clone a master subtree into the result hierarchy (e.g. button swap), preserving bounds and CTA cleanup. */

import { type INode } from '../../host';

import { getBoundsInFrame, setPositionInFrame } from './layout-utils';
import { tryResolveNodeByIdAsync } from './figma-node-resolve';
import { masterButtonSubtreeHasCtaLabelText, removeDetachedCTALabelSiblings } from './semantic-logo-cta';

export async function cloneMasterNodeIntoFrame(
  resultNode: INode,
  masterNodeId: string,
  frame: INode
): Promise<INode> {
  const master = await tryResolveNodeByIdAsync(masterNodeId);
  if (!master || !('clone' in master)) {
    return resultNode;
  }
  if ('removed' in resultNode && resultNode.removed) return resultNode;
  try {
    const clone = (master as any).clone() as INode;
    const parent = resultNode.parent && 'appendChild' in resultNode.parent ? (resultNode.parent as any) : frame;
    parent.appendChild(clone);
    try {
      if (parent.children) {
        const idx = parent.children.indexOf(resultNode as any);
        if (idx >= 0) parent.insertChild(idx, clone);
      }
    } catch (_) {}
    if (!clone.parent || ('removed' in clone && clone.removed)) return resultNode;

    try {
      const srcBounds = getBoundsInFrame(resultNode, frame);
      if (srcBounds.w > 0.5 && srcBounds.h > 0.5) {
        setPositionInFrame(clone, frame, srcBounds.x, srcBounds.y);
      }
    } catch (_) {}

    try {
      if (masterButtonSubtreeHasCtaLabelText(master as INode, frame)) {
        removeDetachedCTALabelSiblings(resultNode, frame);
      }
    } catch (_) {}

    try {
      if (!('removed' in resultNode && resultNode.removed)) resultNode.remove!();
    } catch (_) {}

    return clone;
  } catch (_) {
    return resultNode;
  }
}
