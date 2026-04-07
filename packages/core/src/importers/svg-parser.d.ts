declare module 'svg-parser' {
  interface TextNode {
    type: 'text';
    value?: string;
  }
  interface ElementNode {
    type: 'element';
    tagName?: string;
    properties?: Record<string, string | number>;
    children?: Array<ElementNode | TextNode>;
  }
  interface RootNode {
    type: 'root';
    children: Array<ElementNode | TextNode>;
  }
  export function parse(svg: string): RootNode;
}
