import type { ReactNode } from 'react';

/** Labelled form control wrapper used by every workflow dialog. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="workflow-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Titled workspace section with an optional actions slot in the header. */
export function Panel({
  title,
  subtitle,
  actions,
  className = '',
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ops-panel ${className}`.trim()}>
      <div className="ops-panel-head">
        <div>
          <h2>{title}</h2>
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

export function LiveKpi({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="ops-kpi">
      <span className={`kpi-icon ${tone}`}>{icon}</span>
      <strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
      <span>{label}</span>
      <small>{note}</small>
    </div>
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
