import { SectionHead } from "./shared";

interface Plan {
  id: "free" | "pro" | "team";
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
}

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    cadence: "навсегда",
    tagline: "Всё необходимое для одиночной работы над VN.",
    features: [
      "1 рабочее пространство",
      "Канбан, Script-редактор, Calendar",
      "Локальный AI через LM Studio",
      "Импорт / экспорт .rpy",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "€9",
    cadence: "в месяц",
    tagline: "Для активных авторов и небольших проектов.",
    features: [
      "Безлимит workspaces",
      "Обложки проектов и галерея фото",
      "Расширенные шаблоны сцен",
      "Приоритетная поддержка",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: "€19",
    cadence: "за участника / месяц",
    tagline: "Для студий и переводческих команд.",
    features: [
      "Всё из Pro",
      "Совместная работа: участники, роли",
      "Приглашения переводчиков",
      "Аудит-лог изменений",
    ],
  },
];

const CURRENT_PLAN: Plan["id"] = "free";

export function SubscribeSection() {
  return (
    <>
      <SectionHead
        title="Subscribe"
        subtitle="Тарифы появятся ближе к публичному релизу. Сейчас все фичи доступны бесплатно — это превью того, как будет выглядеть подписка."
      />

      <div className="set-current-banner">
        <span className="set-current-dot" />
        <span>
          Текущий план: <strong>Free</strong>
        </span>
        <span className="set-current-hint">
          оплата ещё не подключена
        </span>
      </div>

      <div className="set-plan-grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === CURRENT_PLAN;
          const isFree = plan.id === "free";
          return (
            <div
              key={plan.id}
              className={
                "set-plan-card" + (isCurrent ? " is-current" : "")
              }
            >
              <div className="set-plan-head">
                <div className="set-plan-name">{plan.name}</div>
                {isCurrent && (
                  <span className="set-plan-badge">Current</span>
                )}
              </div>
              <div className="set-plan-price">
                <span className="set-plan-price-num">{plan.price}</span>
                <span className="set-plan-price-cadence">
                  {plan.cadence}
                </span>
              </div>
              <p className="set-plan-tagline">{plan.tagline}</p>
              <ul className="set-plan-features">
                {plan.features.map((f) => (
                  <li key={f} className="set-plan-feature">
                    <CheckIcon />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={
                  "set-btn" +
                  (isCurrent ? "" : " is-primary") +
                  " set-plan-cta"
                }
                disabled
              >
                {isFree ? "Текущий план" : "Скоро"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="set-info">
        Оплата подключится через Stripe (или аналог) в одной из ближайших
        версий. Если хочешь повлиять на состав тарифов — напиши в
        Integrations → Claude Code, и тариф адаптируется под твой
        сценарий.
      </div>
    </>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden="true"
      className="set-plan-check"
    >
      <path
        d="M3 8.5L6.5 12L13 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
