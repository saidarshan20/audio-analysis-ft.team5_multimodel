/**
 * mermaid-helpers.ts — Utilities for converting CodeAnalysisResult architecture
 * data into a Mermaid flowchart string consumable by MermaidDiagram.
 */

export const MID_PREFIX = 'nd_';
export const safeId = (id: string) => MID_PREFIX + id.replace(/[^a-zA-Z0-9]/g, '_');

// 6-tone dark-theme palette cycling by group
export const GROUP_TONES = ['toneBlue', 'toneAmber', 'toneMint', 'toneRose', 'toneIndigo', 'toneTeal'];

export const SHAPE_DELIMITERS: Record<string, [string, string]> = {
  database: ['[("', '")]'],
  circle:   ['(("', '"))'],
  hexagon:  ['{{\"', '"}}'],
  queue:    ['[/"', '"/]'],
  document: ['["',  '"]'],
  box:      ['["',  '"]'],
};

export function mermaidNode(n: any, indent: string): string {
  const id      = safeId(n.id);
  const label   = (n.label ?? '').replace(/"/g, "'");
  const typeHint = n.type && n.type !== n.label
    ? `<br/><small>${n.type.replace(/"/g, "'")}</small>`
    : '';
  const [s, e] = SHAPE_DELIMITERS[n.shape] ?? SHAPE_DELIMITERS.box;
  return `${indent}${id}${s}${label}${typeHint}${e}\n`;
}

export const generateMermaidGraph = (arch: any): string => {
  if (!arch) return '';
  const nodes: any[]  = arch.nodes  ?? [];
  const groups: any[] = arch.groups ?? [];
  const edges: any[]  = arch.edges  ?? [];
  if (nodes.length === 0) return '';

  // group → tone class
  const groupTone: Record<string, string> = {};
  groups.forEach((g, i) => { groupTone[g.id] = GROUP_TONES[i % GROUP_TONES.length]; });

  // bucket nodes by group
  const byGroup: Record<string, any[]> = {};
  const ungrouped: any[] = [];
  nodes.forEach(n => {
    if (n.group_id && groups.find((g: any) => g.id === n.group_id)) {
      (byGroup[n.group_id] ??= []).push(n);
    } else {
      ungrouped.push(n);
    }
  });

  let chart = 'flowchart TD\n';

  // subgraphs for groups
  groups.forEach((g: any) => {
    const members = byGroup[g.id] ?? [];
    if (members.length === 0) return;
    const sgId = safeId(g.id);
    chart += `  subgraph ${sgId} ["${g.label.replace(/"/g, "'")}"\]\n`;
    members.forEach((n: any) => { chart += mermaidNode(n, '    '); });
    chart += `  end\n`;
  });

  // ungrouped nodes
  ungrouped.forEach((n: any) => { chart += mermaidNode(n, '  '); });

  // edges
  edges.forEach((e: any) => {
    const src   = safeId(e.source);
    const tgt   = safeId(e.target);
    const lbl   = e.label ? `|"${(e.label ?? '').replace(/"/g, "'")}"| ` : '';
    const arrow = e.style === 'dashed' ? '-.->' : '-->';
    chart += `  ${src} ${arrow}${lbl}${tgt}\n`;
  });

  // class definitions (dark-theme palette)
  chart += `
  classDef toneBlue   fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe,stroke-width:2px
  classDef toneAmber  fill:#451a03,stroke:#f59e0b,color:#fde68a,stroke-width:2px
  classDef toneMint   fill:#064e3b,stroke:#10b981,color:#a7f3d0,stroke-width:2px
  classDef toneRose   fill:#4c0519,stroke:#f43f5e,color:#fecdd3,stroke-width:2px
  classDef toneIndigo fill:#1e1b4b,stroke:#6366f1,color:#c7d2fe,stroke-width:2px
  classDef toneTeal   fill:#042f2e,stroke:#14b8a6,color:#99f6e4,stroke-width:2px
  classDef toneGray   fill:#1e293b,stroke:#64748b,color:#cbd5e1,stroke-width:2px
  classDef default    fill:#1e293b,stroke:#fb8c36,color:#f8fafc,stroke-width:2px\n`;

  // apply tones to nodes
  nodes.forEach((n: any) => {
    const tone = n.group_id && groupTone[n.group_id] ? groupTone[n.group_id] : 'toneGray';
    chart += `  class ${safeId(n.id)} ${tone}\n`;
  });

  // style subgraphs
  groups.forEach((g: any) => {
    chart += `  style ${safeId(g.id)} fill:#0a0f1a,stroke:#334155,stroke-dasharray:5 5,color:#94a3b8\n`;
  });

  return chart;
};
