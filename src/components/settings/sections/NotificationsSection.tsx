import { SectionHead } from "./shared";

export function NotificationsSection() {
  return (
    <>
      <SectionHead
        title="Notifications"
        subtitle="Уведомления внутри приложения."
      />
      <div className="set-empty">
        Сейчас все типы уведомлений включены. Тонкая настройка появится
        в одной из ближайших версий.
      </div>
    </>
  );
}
