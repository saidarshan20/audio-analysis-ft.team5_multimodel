import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectGroup {
  label: string;
  options: string[];
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Grouped options (renders group labels) */
  groups?: SelectGroup[];
  /** Flat option list (no group labels) */
  options?: string[];
  /** Text shown when value is empty */
  placeholder?: string;
  /** Renders a first "reset" option with value="" */
  emptyOptionLabel?: string;
  /** Stretch trigger to full container width */
  fullWidth?: boolean;
  className?: string;
}

const FeatureSelectDropdown = ({
  value,
  onChange,
  groups,
  options,
  placeholder = 'Select…',
  emptyOptionLabel,
  fullWidth = false,
  className = '',
}: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const flatOptions = groups ? groups.flatMap(g => g.options) : (options ?? []);

  const displayLabel =
    value === '' && emptyOptionLabel
      ? emptyOptionLabel
      : value
      ? flatOptions.find(o => o === value) ?? value
      : placeholder;

  const isEmpty = !value;

  return (
    <div
      ref={ref}
      className={`fsd-wrap${fullWidth ? ' fsd-wrap--full' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className={`fsd-trigger${open ? ' fsd-trigger--open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`fsd-value${isEmpty ? ' fsd-value--placeholder' : ''}`}>
          {displayLabel}
        </span>
        <ChevronDown size={13} className={`fsd-arrow${open ? ' fsd-arrow--up' : ''}`} />
      </button>

      {open && (
        <div className="fsd-menu" role="listbox">
          {emptyOptionLabel && (
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className={`fsd-option fsd-option--muted${value === '' ? ' fsd-option--active' : ''}`}
              onClick={() => { onChange(''); setOpen(false); }}
            >
              {emptyOptionLabel}
            </button>
          )}

          {groups
            ? groups.map(g => (
                <div key={g.label} className="fsd-group">
                  <div className="fsd-group-label">{g.label}</div>
                  {g.options.map(opt => (
                    <button
                      key={opt}
                      type="button"
                      role="option"
                      aria-selected={opt === value}
                      className={`fsd-option${opt === value ? ' fsd-option--active' : ''}`}
                      onClick={() => { onChange(opt); setOpen(false); }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ))
            : (options ?? []).map(opt => (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={opt === value}
                  className={`fsd-option${opt === value ? ' fsd-option--active' : ''}`}
                  onClick={() => { onChange(opt); setOpen(false); }}
                >
                  {opt}
                </button>
              ))}
        </div>
      )}
    </div>
  );
};

export default FeatureSelectDropdown;
