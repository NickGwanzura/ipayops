import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { HelpTip } from './help-tip';

/**
 * Dashboard KPI tile. Clickable (renders a button) when onClick is given, which is the drilldown to the records
 * behind the number. `help` adds an explanatory "?" tip; `change` is "Live" or a signed delta like "-4%".
 */
export function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'blue',
  change = 'Live',
  onClick,
  help,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  tone?: string;
  change?: string;
  onClick?: () => void;
  help?: string;
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
      <div className="stat-label">
        {label}
        {help && !onClick && <HelpTip text={help} label={label} />}
      </div>
      <div className="stat-note">{note}</div>
    </>
  );
  if (!onClick) return <div className="stat-card">{content}</div>;
  // A button cannot contain another button, so the help tip sits beside the clickable card, not inside it.
  const card = (
    <button className="stat-card role-stat-action" onClick={onClick} title={`Open ${label}`}>
      {content}
    </button>
  );
  return help ? (
    <div className="kpi-shell">
      {card}
      <span className="kpi-help">
        <HelpTip text={help} label={label} align="right" />
      </span>
    </div>
  ) : (
    card
  );
}
