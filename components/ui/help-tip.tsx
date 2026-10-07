'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * Small "?" button that explains a label or number. Opens on hover, keyboard focus or tap, closes on Escape or an
 * outside click, and is announced to screen readers through aria-describedby.
 */
export function HelpTip({
  text,
  label = 'this item',
  align = 'left',
}: {
  text: string;
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span ref={root} className={`help-tip help-tip-${align}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="help-tip-button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <CircleHelp size={13} aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className="help-tip-bubble">
        {text}
      </span>
    </span>
  );
}
