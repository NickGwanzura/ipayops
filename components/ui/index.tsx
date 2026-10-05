import type { ReactNode } from 'react';
import { HelpTip } from './help-tip';

/** Labelled form control wrapper used by every workflow dialog. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="workflow-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Titled workspace section with an optional help tip and actions slot in the header. */
export function Panel({
  title,
  subtitle,
  actions,
  help,
  className = '',
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  help?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ops-panel ${className}`.trim()}>
      <div className="ops-panel-head">
        <div>
          <h2>
            {title}
            {help && <HelpTip text={help} label={title} />}
          </h2>
          <p>{subtitle}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function TableHead({ labels }: { labels: string[] }) {
  return (
    <div className="table-head ops-table-head">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

/** Status pill; the CSS class is the lower-cased, hyphenated status text (e.g. "In transit" -> "in-transit"). */
export function Status({ value }: { value: string }) {
  const key = value.toLowerCase().replaceAll(' ', '-');
  return <span className={`status ${key}`}>{value}</span>;
}

/** Workspace KPI tile. With onClick it becomes a drilldown button; `active` marks the filter it currently applies. */
export function LiveKpi({
  label,
  value,
  note,
  icon,
  tone,
  onClick,
  active = false,
  help,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  tone: string;
  onClick?: () => void;
  active?: boolean;
  help?: string;
}) {
  const body = (
    <>
      <span className={`kpi-icon ${tone}`}>{icon}</span>
      <strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
      <span>
        {label}
        {help && !onClick && <HelpTip text={help} label={label} />}
      </span>
      <small>{note}</small>
    </>
  );
  if (!onClick) return <div className="ops-kpi">{body}</div>;
  const button = (
    <button
      type="button"
      className={`ops-kpi ops-kpi-action${active ? ' active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={`Show ${label.toLowerCase()}`}
    >
      {body}
    </button>
  );
  // A button cannot contain another button, so the help tip sits beside the clickable tile, not inside it.
  return help ? (
    <div className="kpi-shell">
      {button}
      <span className="kpi-help">
        <HelpTip text={help} label={label} align="right" />
      </span>
    </div>
  ) : (
    button
  );
}

export function Empty({ title, detail, icon }: { title: string; detail: string; icon: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
