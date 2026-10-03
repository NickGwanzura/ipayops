import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

/** Dashboard KPI tile. Clickable (renders a button) when onClick is given; `change` is "Live" or a signed delta like "-4%". */
export function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'blue',
  change = 'Live',
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  tone?: string;
  change?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span className={`icon-box ${tone}`}>{icon}</span>
        {change && (
          <span className={change.startsWith('-') ? 'change down' : 'change'}>
            {change === 'Live' ? (
              'Live'
            ) : (
              <>
                {change.startsWith('-') ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{' '}
                {change.replace('-', '')}
              </>
            )}
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-note">{note}</div>
    </>
  );
  return onClick ? (
    <button className="stat-card role-stat-action" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat-card">{content}</div>
  );
}
