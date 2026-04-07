/**
 * Frame Analyzer
 *
 * Analyzes frame content before resize.
 * Detects text, image, vector nodes and their roles.
 */

import { type INode, NodeType, type IPaint, type IImagePaint } from '../../host';
import {
    FrameAnalysis,
    NodeTransform,
    RelativePosition
} from '../contracts/types';

/**
 * Analyzes the frame and collects information about its content
 */
export function analyzeFrame(frame: INode): FrameAnalysis {
    const analysis: FrameAnalysis = {
        frameId: frame.id,
        width: frame.width,
        height: frame.height,
        hasTextNodes: false,
        hasVectorNodes: false,
        hasRasterImages: false,
        hasNestedFrames: false,
        backgroundType: 'none',
        backgroundImageHash: null,
        transforms: new Map()
    };

    // Analyze frame background
    analyzeBackground(frame, analysis);

    // Recursively traverse children
    traverseChildren(frame, frame, analysis);

    return analysis;
}

/**
 * Analyzes frame background
 */
function analyzeBackground(frame: INode, analysis: FrameAnalysis): void {
    const fills = frame.fills as readonly IPaint[];

    if (!fills || fills.length === 0) {
        analysis.backgroundType = 'none';
        return;
    }

    // Check fills in reverse order (top layer first)
    for (let i = fills.length - 1; i >= 0; i--) {
        const fill = fills[i];

        // Skip invisible fills
        if ('visible' in fill && fill.visible === false) continue;

        if (fill.type === 'IMAGE') {
            analysis.backgroundType = 'image';
            analysis.backgroundImageHash = (fill as IImagePaint).imageHash ?? null;
            analysis.hasRasterImages = true;
            return;
        } else if (fill.type === 'SOLID') {
            analysis.backgroundType = 'solid';
            return;
        } else if (fill.type.startsWith('GRADIENT')) {
            analysis.backgroundType = 'gradient';
            return;
        }
    }
}

/**
 * Recursively traverses frame children
 */
function traverseChildren(
    node: INode,
    rootFrame: INode,
    analysis: FrameAnalysis,
    path: string = ''
): void {
    if (!node.children) return;

    for (const child of node.children) {
        const nodePath = path ? `${path}/${child.name}` : child.name;

        // Collect transform
        const transform = createNodeTransform(child, rootFrame, nodePath);
        analysis.transforms.set(child.id, transform);

        // Classify the node
        classifyNode(child, analysis);

        // Recursively process children
        if (child.children !== undefined) {
            if (child.type === NodeType.Frame) {
                analysis.hasNestedFrames = true;
            }
            traverseChildren(child, rootFrame, analysis, nodePath);
        }
    }
}

/**
 * Creates a transform object for the node
 */
function createNodeTransform(
    node: INode,
    rootFrame: INode,
    path: string
): NodeTransform {
    const position = calculateRelativePosition(node, rootFrame);

    const transform: NodeTransform = {
        nodeId: node.id,
        nodeName: path,
        nodeType: node.type,
        position
    };

    // For text nodes save font information
    if (node.type === NodeType.Text) {
        const fontSize = node.fontSize;

        if (typeof fontSize === 'number') {
            transform.fontSize = fontSize;
            transform.fontSizeRelative = fontSize / rootFrame.height;
        }
    }

    return transform;
}

/**
 * Calculates relative position of a node
 */
function calculateRelativePosition(
    node: INode,
    rootFrame: INode
): RelativePosition {
    return {
        relativeX: (node.x - rootFrame.x) / rootFrame.width,
        relativeY: (node.y - rootFrame.y) / rootFrame.height,
        relativeWidth: node.width / rootFrame.width,
        relativeHeight: node.height / rootFrame.height
    };
}

/**
 * Classifies a node and updates analysis flags
 */
function classifyNode(node: INode, analysis: FrameAnalysis): void {
    switch (node.type) {
        case NodeType.Text:
            analysis.hasTextNodes = true;
            break;

        case NodeType.Vector:
        case NodeType.BooleanOp:
        case NodeType.Star:
        case NodeType.Polygon:
        case NodeType.Line:
            analysis.hasVectorNodes = true;
            break;

        case NodeType.Rectangle:
        case NodeType.Ellipse:
            // Check for IMAGE fill
            if (hasImageFill(node)) {
                analysis.hasRasterImages = true;
            }
            break;

        case NodeType.Frame:
        case NodeType.Group:
        case NodeType.Component:
        case NodeType.Instance:
            // Check fills for containers
            if ('fills' in node && hasImageFill(node)) {
                analysis.hasRasterImages = true;
            }
            break;
    }
}

/**
 * Checks whether a node has an IMAGE fill
 */
function hasImageFill(node: INode): boolean {
    if (!('fills' in node)) return false;

    const fills = node.fills as readonly IPaint[];
    if (!fills) return false;

    return fills.some(fill =>
        fill.type === 'IMAGE' &&
        ('visible' in fill ? fill.visible !== false : true)
    );
}

/**
 * Gets all nodes with IMAGE fill
 */
export function findImageNodes(frame: INode): INode[] {
    const imageNodes: INode[] = [];

    function traverse(node: INode) {
        if (hasImageFill(node)) {
            imageNodes.push(node);
        }

        if (node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }

    if (hasImageFill(frame)) {
        imageNodes.push(frame);
    }

    for (const child of frame.children ?? []) {
        traverse(child);
    }

    return imageNodes;
}

/**
 * Gets all text nodes
 */
export function findTextNodes(frame: INode): INode[] {
    const textNodes: INode[] = [];

    function traverse(node: INode) {
        if (node.type === NodeType.Text) {
            textNodes.push(node);
        }

        if (node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }

    for (const child of frame.children ?? []) {
        traverse(child);
    }

    return textNodes;
}

/**
 * Gets all vector nodes
 */
export function findVectorNodes(frame: INode): INode[] {
    const vectorNodes: INode[] = [];
    const vectorTypes = [NodeType.Vector, NodeType.BooleanOp, NodeType.Star, NodeType.Polygon, NodeType.Line];

    function traverse(node: INode) {
        if (vectorTypes.includes(node.type as any)) {
            vectorNodes.push(node);
        }

        if (node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }

    for (const child of frame.children ?? []) {
        traverse(child);
    }

    return vectorNodes;
}
