import { describe, expect, test } from 'bun:test';

import { renderMermaidSVG } from 'beautiful-mermaid';

const registrationFlowchart = `flowchart TD
    A([首页]) --> B[点击「注册」]
    B --> C[输入邮箱和密码]
    C --> D[点击「创建账户」]
    D --> E{注册结果}
    E -->|失败| C
    E -->|成功| F[查收邮件 输入6位验证码]
    F --> G[点击「进入 CUG」]
    G --> H{验证结果}
    H -->|失败| F
    H -->|成功| I([进入 /student 主页])
`;

function extractNodeTop(svg: string, nodeId: string): number {
    const nodeMatch = svg.match(new RegExp(`<g class="node" data-id="${nodeId}"[\\s\\S]*?<\\/g>`));

    if (!nodeMatch) {
        throw new Error(`Missing SVG node ${nodeId}`);
    }

    const nodeSvg = nodeMatch[0];
    const rectMatch = nodeSvg.match(/<rect\b[^>]*\by="([^"]+)"/);

    if (rectMatch?.[1]) {
        return Number(rectMatch[1]);
    }

    const polygonMatch = nodeSvg.match(/<polygon\b[^>]*\bpoints="([^"]+)"/);

    if (polygonMatch?.[1]) {
        const yCoordinates = polygonMatch[1]
            .trim()
            .split(/\s+/)
            .map((point) => Number(point.split(',')[1]));

        return Math.min(...yCoordinates);
    }

    throw new Error(`Missing SVG shape position for node ${nodeId}`);
}

describe('beautiful-mermaid flowchart layout', () => {
    test('keeps cyclic top-down flowcharts in source order', () => {
        const svg = renderMermaidSVG(registrationFlowchart);
        const yByNode = Object.fromEntries(
            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((nodeId) => [nodeId, extractNodeTop(svg, nodeId)]),
        );

        expect(yByNode.A).toBeLessThan(yByNode.B);
        expect(yByNode.B).toBeLessThan(yByNode.C);
        expect(yByNode.C).toBeLessThan(yByNode.D);
        expect(yByNode.D).toBeLessThan(yByNode.E);
        expect(yByNode.E).toBeLessThan(yByNode.F);
        expect(yByNode.F).toBeLessThan(yByNode.G);
        expect(yByNode.G).toBeLessThan(yByNode.H);
        expect(yByNode.H).toBeLessThan(yByNode.I);
    });
});
