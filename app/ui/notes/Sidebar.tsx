// A barra lateral (B v4): só pastas e notas, sem ícone, contador nem caixa. Selecionada é só peso de texto.

import type { ReactElement } from "react";

import type { TreeNode } from "./tree.ts";

export interface SidebarProps {
  tree: TreeNode[];
  open: Set<string>;
  current: string | null;
  onToggle(folder: string): void;
  onOpen(path: string): void;
}

export function Sidebar({ tree, open, current, onToggle, onOpen }: SidebarProps) {
  const items = (nodes: TreeNode[], depth: number): ReactElement[] =>
    nodes.flatMap((n) => {
      const style = { paddingLeft: depth * 14 };
      if (n.kind === "folder") {
        const expanded = open.has(n.path);
        return [
          <button
            type="button"
            key={`f:${n.path}`}
            className="kn-side-item"
            data-kind="folder"
            aria-expanded={expanded}
            style={style}
            onClick={() => onToggle(n.path)}
          >
            {n.name}
          </button>,
          ...(expanded ? items(n.children, depth + 1) : []),
        ];
      }
      return [
        <button
          type="button"
          key={`n:${n.path}`}
          className="kn-side-item"
          data-kind="note"
          aria-current={n.path === current ? "page" : undefined}
          style={style}
          onClick={() => onOpen(n.path)}
        >
          {n.name}
        </button>,
      ];
    });

  return (
    <nav className="kn-side" aria-label="Notas">
      <div className="kn-side-head">Notas</div>
      {items(tree, 0)}
    </nav>
  );
}
