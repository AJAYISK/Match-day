-- MATCH ERA — Update 8. Re-run-safe. Run once in SQL Editor.

-- Artwork share counter
alter table public.matches add column if not exists shares int not null default 0;
create or replace function public.increment_shares(p_match_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.matches set shares = coalesce(shares, 0) + 1 where id = p_match_id;
$$;

-- Forgot-password: safe email existence check
create or replace function public.email_exists(p_email text)
returns boolean language sql security definer set search_path = public as $$
  select exists(select 1 from public.profiles where lower(email) = lower(p_email));
$$;

-- Captain announcements (24-hour life, one per day enforced in app)
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists read_announcements on public.announcements;
create policy read_announcements on public.announcements
  for select using (auth.role() = 'authenticated');
drop policy if exists captains_post_own_announcement on public.announcements;
create policy captains_post_own_announcement on public.announcements
  for insert with check (captain_id = auth.uid());
drop policy if exists manage_own_announcement on public.announcements;
create policy manage_own_announcement on public.announcements
  for delete using (captain_id = auth.uid() or public.my_role() = 'Admin');

-- Blocked emails: barred from re-registering
create table if not exists public.blocked_emails (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.blocked_emails enable row level security;
drop policy if exists admins_manage_blocked_emails on public.blocked_emails;
create policy admins_manage_blocked_emails on public.blocked_emails
  for all using (public.my_role() = 'Admin') with check (public.my_role() = 'Admin');

-- Signup trigger: refuse blocked emails, keep saving state + email
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.blocked_emails where lower(email) = lower(new.email)) then
    raise exception 'This email has been restricted by the Match Era admin';
  end if;
  insert into public.profiles (id, name, role, state, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Player'),
    coalesce(new.raw_user_meta_data->>'role', 'Fan'),
    new.raw_user_meta_data->>'state',
    new.email
  );
  insert into public.wallets (user_id, balance) values (new.id, 0);
  return new;
end $$;

-- FULL-TIME TRIGGER: alert admins + scoreless ticker note the moment
-- any match enters AwaitingScore (captain's phone OR server whistle)
create or replace function public.on_awaiting_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'AwaitingScore' and old.status is distinct from 'AwaitingScore' then
    insert into public.notifications (user_id, message)
    select id, 'Match ended: ' || new.team_a_name || ' vs ' || new.team_b_name || ' — waiting for the captain''s score.'
    from public.profiles where role = 'Admin';
    insert into public.match_events (match_id, message)
    values (new.id, '🏁 Full time: ' || new.team_a_name || ' vs ' || new.team_b_name || ' — official result coming soon');
  end if;
  return new;
end $$;
drop trigger if exists trg_awaiting_score on public.matches;
create trigger trg_awaiting_score
  after update on public.matches
  for each row execute function public.on_awaiting_score();

-- THE SERVER WHISTLE: every minute, end any live running match whose
-- clock has passed full time — even if the captain is offline.
select cron.unschedule('full-time-whistle') where exists
  (select 1 from cron.job where jobname = 'full-time-whistle');
select cron.schedule('full-time-whistle', '* * * * *', $$
  update public.matches set
    elapsed_seconds = duration_minutes * 60,
    running = false,
    timer_started_at = null,
    status = 'AwaitingScore',
    awaiting_since = now()
  where status = 'Live'
    and running = true
    and timer_started_at is not null
    and elapsed_seconds + extract(epoch from (now() - timer_started_at)) >= duration_minutes * 60;
$$);

-- Cancelled matches: purge after 2 days (was 7)
select cron.unschedule('purge-cancelled') where exists
  (select 1 from cron.job where jobname = 'purge-cancelled');
select cron.schedule('purge-cancelled', '10 3 * * *', $$
  delete from public.matches
  where status = 'Cancelled' and cancelled_at < now() - interval '2 days';
$$);

-- Announcements: hourly purge of anything older than 24 hours
select cron.unschedule('purge-announcements') where exists
  (select 1 from cron.job where jobname = 'purge-announcements');
select cron.schedule('purge-announcements', '5 * * * *', $$
  delete from public.announcements where created_at < now() - interval '24 hours';
$$);
