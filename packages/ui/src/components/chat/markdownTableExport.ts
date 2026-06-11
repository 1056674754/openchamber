export type TableData = {
  headers: string[];
  rows: string[][];
};

export type TableCopyFormat = 'csv' | 'tsv' | 'markdown';

export const tableToCSV = ({ headers, rows }: TableData): string => {
  const escapeCell = (cell: string): string => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const lines: string[] = [];
  if (headers.length > 0) {
    lines.push(headers.map(escapeCell).join(','));
  }
  rows.forEach((row) => lines.push(row.map(escapeCell).join(',')));
  return lines.join('\n');
};

export const tableToTSV = ({ headers, rows }: TableData): string => {
  const escapeCell = (cell: string): string => cell.replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

  const lines: string[] = [];
  if (headers.length > 0) {
    lines.push(headers.map(escapeCell).join('\t'));
  }
  rows.forEach((row) => lines.push(row.map(escapeCell).join('\t')));
  return lines.join('\n');
};

export const tableToMarkdown = ({ headers, rows }: TableData): string => {
  if (headers.length === 0) return '';

  const escapeCell = (cell: string): string => cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

  const lines: string[] = [];
  lines.push(`| ${headers.map(escapeCell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  rows.forEach((row) => {
    const paddedRow = headers.map((_, index) => escapeCell(row[index] || ''));
    lines.push(`| ${paddedRow.join(' | ')} |`);
  });
  return lines.join('\n');
};

export const getTableCopyContent = (data: TableData, format: TableCopyFormat): string => {
  switch (format) {
    case 'csv':
      return tableToCSV(data);
    case 'tsv':
      return tableToTSV(data);
    case 'markdown':
      return tableToMarkdown(data);
    default: {
      const exhaustive: never = format;
      return exhaustive;
    }
  }
};
