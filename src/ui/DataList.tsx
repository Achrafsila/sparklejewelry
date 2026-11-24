import type { ReactNode } from 'react';
import { messageFor, type AppError } from '../lib/errors';
import { useMediaQuery, WIDE } from '../lib/useMediaQuery';
import { Button } from './Button';
import { Skeleton } from './Controls';
import { IconRetry } from './icons';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render(row: T): ReactNode;
  numeric?: boolean;
  className?: string;
}

interface DataListProps<T> {
  label: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey(row: T): string;
  /** Phone layout: one card per row. */
  renderCard(row: T): ReactNode;
  empty: ReactNode;
  loading?: boolean;
  error?: AppError | null;
  onRetry?(): void;
  rowClassName?(row: T): string | undefined;
}

/** A table on tablets and computers, a list of cards on phones; with loading, empty and error states. */
export function DataList<T>({
  label,
  columns,
  rows,
  rowKey,
  renderCard,
  empty,
  loading,
  error,
  onRetry,
  rowClassName,
}: DataListProps<T>) {
  const wide = useMediaQuery(WIDE);

  if (error && !rows?.length) {
    return (
      <div className="empty" role="alert">
        <p className="empty__title">{messageFor(error)}</p>
        {onRetry && (
          <Button variant="secondary" icon={<IconRetry size={16} aria-hidden="true" />} onClick={onRetry}>
            Réessayer
          </Button>
        )}
      </div>
    );
  }
  if (!rows || (loading && rows.length === 0)) return <Skeleton rows={4} label={`Chargement : ${label}`} />;
  if (rows.length === 0) return <>{empty}</>;

  if (!wide) {
    return (
      <ul className="cards" aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)} className={['card', rowClassName?.(row)].filter(Boolean).join(' ')}>
            {renderCard(row)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={[c.numeric && 'num', c.className].filter(Boolean).join(' ')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((c) => (
                <td key={c.key} className={[c.numeric && 'num', c.className].filter(Boolean).join(' ')}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
