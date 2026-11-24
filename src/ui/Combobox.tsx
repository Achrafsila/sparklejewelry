import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Field } from './Field';

interface ComboboxProps<T> {
  label: string;
  items: T[];
  getKey(item: T): string;
  /** Text matched against the query and announced for the option. */
  getText(item: T): string;
  renderItem?(item: T): ReactNode;
  onSelect(item: T): void;
  placeholder?: string;
  error?: string | null;
  hint?: ReactNode;
  emptyText?: string;
  maxResults?: number;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Search-as-you-type list (WAI-ARIA combobox): arrows to move, Enter to choose, Escape to close. */
export function Combobox<T>({
  label,
  items,
  getKey,
  getText,
  renderItem,
  onSelect,
  placeholder,
  error,
  hint,
  emptyText = 'Aucun résultat.',
  maxResults = 8,
}: ComboboxProps<T>) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const matching = words.length ? items.filter((i) => words.every((w) => fold(getText(i)).includes(w))) : items;
    return matching.slice(0, maxResults);
  }, [items, query, getText, maxResults]);

  function choose(item: T) {
    onSelect(item);
    setQuery('');
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const item = results[active];
      if (open && item) {
        e.preventDefault();
        choose(item);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  const activeId = active >= 0 && results[active] ? `${listId}-${getKey(results[active])}` : undefined;
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => (
        <div className="combobox">
          <input
            {...p}
            className="input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
          />
          {open && (
            <ul className="combobox__list" id={listId} role="listbox" aria-label={label}>
              {results.length === 0 && <li className="combobox__empty">{emptyText}</li>}
              {results.map((item, i) => (
                <li
                  key={getKey(item)}
                  id={`${listId}-${getKey(item)}`}
                  role="option"
                  aria-selected={i === active}
                  className="combobox__option"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                >
                  {renderItem ? renderItem(item) : getText(item)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
