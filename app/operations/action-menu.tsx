'use client';

import { MoreHorizontal } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';

export function ActionMenu({ label = 'More actions', children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, []);

  return (
    <details ref={ref} className="ops-action-menu">
      <summary aria-label={label} title={label}>
        <MoreHorizontal size={17} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </summary>
      <div className="ops-action-menu-popover" role="menu" aria-label={label}>
        {children}
      </div>
    </details>
  );
}

export function ActionMenuItem({ children, onClick, disabled = false, className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" role="menuitem" className={`ops-action-menu-item ${className}`} onClick={event => { onClick?.(); event.currentTarget.closest('details')?.removeAttribute('open'); }} disabled={disabled}>{children}</button>;
}
