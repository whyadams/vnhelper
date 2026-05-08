interface ComingSoonScreenProps {
  title: string;
  description?: string;
}

export function ComingSoonScreen({ title, description }: ComingSoonScreenProps) {
  return (
    <main className="main coming-soon">
      <div className="coming-soon-card">
        <div className="coming-soon-badge">Coming soon</div>
        <h1 className="coming-soon-title">{title}</h1>
        <p className="coming-soon-sub">Временно недоступно</p>
        {description && <p className="coming-soon-desc">{description}</p>}
      </div>
    </main>
  );
}
