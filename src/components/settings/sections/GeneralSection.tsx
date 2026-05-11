import { SectionHead } from "./shared";

export function GeneralSection() {
  return (
    <>
      <SectionHead
        title="General"
        subtitle="Базовые настройки приложения."
      />
      <div className="set-empty">
        Тема и язык интерфейса пока зашиты по умолчанию (тёмная,
        русско-английский UI). Переключатели появятся в следующих версиях.
      </div>
    </>
  );
}
