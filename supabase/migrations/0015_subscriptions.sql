-- Subscription tracking. Every new user gets a row with `tier='pro'` and a
-- `trial_ends_at` 2 days out (the demo). The effective tier resolves through
-- `private.user_tier(uid)` which checks the status + trial window — that's
-- what RLS guards consult.

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'pro' check (tier in ('free', 'pro')),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  -- Bookkeeping for an eventual billing-provider webhook (stripe/paddle/...).
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "subscriptions self read"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create or replace function public.seed_subscription_for_user(_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, tier, status, trial_ends_at)
  values (_uid, 'pro', 'trialing', now() + interval '2 days')
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_subscription_for_user(new.id);
  return new;
end;
$$;

create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

insert into public.subscriptions (user_id, tier, status, trial_ends_at)
select id, 'pro', 'trialing', now() + interval '2 days'
from auth.users
on conflict (user_id) do nothing;

create or replace function private.user_tier(_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when s.status = 'active' then s.tier
      when s.status = 'trialing'
        and s.trial_ends_at is not null
        and s.trial_ends_at > now() then s.tier
      else 'free'
    end
  from public.subscriptions s
  where s.user_id = _uid
  union all
  select 'free'
  limit 1;
$$;

create or replace view public.my_subscription
with (security_invoker = on)
as
select
  s.user_id,
  s.tier as raw_tier,
  s.status,
  s.trial_ends_at,
  s.current_period_end,
  private.user_tier(s.user_id) as effective_tier
from public.subscriptions s
where s.user_id = auth.uid();

grant select on public.my_subscription to authenticated;
