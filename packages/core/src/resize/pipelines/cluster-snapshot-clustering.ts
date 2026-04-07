export interface NodeSnapshot {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
    name: string;
}

export function snapshotRectsTouch(a: NodeSnapshot, b: NodeSnapshot, margin: number): boolean {
    return !(
        b.x > a.x + a.width + margin ||
        b.x + b.width < a.x - margin ||
        b.y > a.y + a.height + margin ||
        b.y + b.height < a.y - margin
    );
}

export function findSnapshotClusters(snapshots: NodeSnapshot[], margin: number): NodeSnapshot[][] {
    if (snapshots.length <= 1) return snapshots.map(s => [s]);
    const clusters: NodeSnapshot[][] = [];
    const visited = new Set<string>();
    for (const startNode of snapshots) {
        if (visited.has(startNode.id)) continue;
        const currentCluster: NodeSnapshot[] = [];
        const queue = [startNode];
        visited.add(startNode.id);
        while (queue.length > 0) {
            const node = queue.shift()!;
            currentCluster.push(node);
            for (const neighbor of snapshots) {
                if (visited.has(neighbor.id)) continue;
                if (snapshotRectsTouch(node, neighbor, margin)) {
                    visited.add(neighbor.id);
                    queue.push(neighbor);
                }
            }
        }
        clusters.push(currentCluster);
    }
    return clusters;
}
