export const TABLE_COLUMN_MIN_WIDTH = 120;
export const TABLE_COLUMN_MAX_WIDTH = 320;
const TABLE_LAYOUT_ATTR = 'data-md-table-layout';

export const getTableColumnWidth = (measured: number): number => (
  Math.min(TABLE_COLUMN_MAX_WIDTH, Math.max(TABLE_COLUMN_MIN_WIDTH, Math.ceil(measured)))
);

// Markdown chat tables size to their content: each column is measured with an
// offscreen nowrap probe, clamped to [min, max], then locked in via a colgroup
// and table-layout: fixed so streaming updates cannot jiggle the columns.
export const stabilizeMarkdownTableWidths = (root: HTMLElement): void => {
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>(
    `table[data-markdown="table"]:not([${TABLE_LAYOUT_ATTR}="fixed"])`,
  ));
  if (tables.length === 0 || !root.isConnected) return;

  const measurementRoot = root.ownerDocument.createElement('div');
  measurementRoot.setAttribute('aria-hidden', 'true');
  measurementRoot.setAttribute('data-md-table-measure', '');
  measurementRoot.style.position = 'fixed';
  measurementRoot.style.left = '-100000px';
  measurementRoot.style.top = '0';
  measurementRoot.style.visibility = 'hidden';
  measurementRoot.style.pointerEvents = 'none';
  measurementRoot.style.width = 'max-content';

  const probes = tables.map((table) => {
    const getRowCells = (row: HTMLTableRowElement): HTMLTableCellElement[] => (
      Array.from(row.children).filter((child): child is HTMLTableCellElement => (
        child.tagName === 'TH' || child.tagName === 'TD'
      ))
    );
    const bodyRows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    const sourceRows = bodyRows.some((row) => getRowCells(row).length > 0)
      ? bodyRows
      : Array.from(table.querySelectorAll<HTMLTableRowElement>('thead tr'));
    const columnCount = Math.max(
      0,
      ...Array.from(table.querySelectorAll<HTMLTableRowElement>('tr')).map((row) => getRowCells(row).length),
    );
    const columnProbes: HTMLTableElement[] = [];

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const probeTable = root.ownerDocument.createElement('table');
      probeTable.className = table.className;
      probeTable.style.tableLayout = 'auto';
      probeTable.style.width = 'max-content';
      const probeBody = root.ownerDocument.createElement('tbody');

      for (const row of sourceRows) {
        const sourceCell = getRowCells(row)[columnIndex];
        if (!sourceCell) continue;
        const probeRow = root.ownerDocument.createElement('tr');
        const probeCell = sourceCell.cloneNode(true);
        if (!(probeCell instanceof HTMLElement)) continue;
        probeCell.style.width = 'auto';
        probeCell.style.minWidth = '0';
        probeCell.style.maxWidth = 'none';
        probeCell.style.whiteSpace = 'nowrap';
        probeCell.style.overflowWrap = 'normal';
        probeRow.appendChild(probeCell);
        probeBody.appendChild(probeRow);
      }

      probeTable.appendChild(probeBody);
      measurementRoot.appendChild(probeTable);
      columnProbes.push(probeTable);
    }

    return { table, columnProbes };
  });

  root.appendChild(measurementRoot);
  const plans = probes.map(({ table, columnProbes }) => ({
    table,
    widths: columnProbes.map((probe) => getTableColumnWidth(probe.getBoundingClientRect().width)),
  }));
  measurementRoot.remove();

  for (const { table, widths } of plans) {
    const existingColumns = Array.from(table.children).find((child) => (
      child.matches('colgroup[data-md-table-columns]')
    ));
    existingColumns?.remove();

    const colgroup = root.ownerDocument.createElement('colgroup');
    colgroup.setAttribute('data-md-table-columns', '');
    for (const width of widths) {
      const column = root.ownerDocument.createElement('col');
      column.style.width = `${width}px`;
      colgroup.appendChild(column);
    }
    const firstSection = Array.from(table.children).find((child) => (
      child.tagName === 'THEAD' || child.tagName === 'TBODY' || child.tagName === 'TFOOT'
    )) ?? null;
    table.insertBefore(colgroup, firstSection);
    table.style.tableLayout = 'fixed';
    table.style.width = `${widths.reduce((total, width) => total + width, 0)}px`;
    table.setAttribute(TABLE_LAYOUT_ATTR, 'fixed');
  }
};
