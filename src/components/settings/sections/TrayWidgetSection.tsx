import { SectionHead } from "./shared";

export function TrayWidgetSection() {
  return (
    <>
      <SectionHead
        title="Tray & Widget"
        subtitle="Поведение системного трея и плавающего виджета."
      />
      <div className="set-card">
        <div className="set-row-title">Tray (system tray icon)</div>
        <div className="set-row-desc" style={{ marginTop: 4 }}>
          Иконка в трее показывает до 30 активных задач из колонок To Do / In
          Progress / Review. Клик по задаче — открыть приложение и
          сфокусироваться на карточке.
        </div>
      </div>
      <div className="set-card">
        <div className="set-row-title">Widget</div>
        <div className="set-row-desc" style={{ marginTop: 4 }}>
          Always-on-top окно с компактным канбаном. Открывается из шапки
          приложения. Делит сессию Supabase с основным окном через WebView2
          storage.
        </div>
      </div>
      <div className="set-empty">
        Тонкие настройки трея (закрытие в трей, автозапуск виджета) появятся
        в одной из ближайших версий.
      </div>
    </>
  );
}
