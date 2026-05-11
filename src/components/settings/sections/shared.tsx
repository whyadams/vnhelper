interface Props {
  title: string;
  subtitle?: string;
}

export function SectionHead({ title, subtitle }: Props) {
  return (
    <div className="set-section-head">
      <h2 className="set-section-h">{title}</h2>
      {subtitle && <p className="set-section-sub">{subtitle}</p>}
    </div>
  );
}
