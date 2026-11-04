import type { ReactNode } from 'react';
import styles from './Table.module.css';

export function Table({
  headers,
  rows,
}: {
  headers: Array<{ label: string; right?: boolean }>;
  rows: Array<{
    key: string;
    cells: ReactNode[];
    onClick?: () => void;
  }>;
}) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h.label} className={h.right ? styles.right : undefined}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={row.onClick ? styles.click : undefined}
              onClick={row.onClick}
              onKeyDown={
                row.onClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        row.onClick?.();
                      }
                    }
                  : undefined
              }
              tabIndex={row.onClick ? 0 : undefined}
            >
              {row.cells.map((cell, i) => (
                <td
                  key={headers[i]?.label ?? `cell-${row.key}-${String(cell)}`}
                  className={headers[i]?.right ? styles.right : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const tableStyles = styles;
