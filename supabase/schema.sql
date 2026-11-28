-- ============================================================
--  EFEKTIVITAS BULANAN — Supabase schema
--  Jalankan seluruh file ini di Supabase Dashboard > SQL Editor.
--  Aman dijalankan ulang (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSION
-- ------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- TABEL
-- ------------------------------------------------------------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Rumah Tangga',
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Anggota',
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid not null references auth.users(id) on delete cascade,
  entry_date   date not null default current_date,
  type         text not null check (type in ('budget', 'expense')),
  category     text not null default 'Lainnya',
  description  text not null,
  amount       numeric(14, 2) not null check (amount > 0),
  created_at   timestamptz not null default now()
);

create table if not exists public.menu_items (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  name           text not null,
  category       text not null default 'Masak Kos',
  kind           text not null default 'masak' check (kind in ('masak', 'jajan')),
  default_amount numeric(14, 2) not null default 0,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

-- Kode akses login tanpa email. Hanya owner yang boleh membaca/mengubah
-- lewat RPC; Edge Function memakai service role untuk memvalidasi kode.
create table if not exists public.household_access (
  household_id  uuid primary key references public.households(id) on delete cascade,
  code          text not null unique,
  token         text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  updated_at    timestamptz not null default now()
);

-- Catatan percobaan login kode/QR untuk rate limit di Edge Function.
create table if not exists public.access_login_attempts (
  id           bigserial primary key,
  identifier   text not null,
  ip           text not null default '',
  success      boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists entries_household_date_idx
  on public.entries (household_id, entry_date desc);
create index if not exists menu_items_household_idx
  on public.menu_items (household_id, kind, sort_order);
create index if not exists household_members_user_idx
  on public.household_members (user_id);
create index if not exists access_attempts_ip_idx
  on public.access_login_attempts (ip, attempted_at desc);
create index if not exists access_attempts_identifier_idx
  on public.access_login_attempts (identifier, attempted_at desc);

-- ------------------------------------------------------------
-- HELPER: cek keanggotaan (security definer agar tidak rekursi RLS)
-- ------------------------------------------------------------
create or replace function public.is_household_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

-- ------------------------------------------------------------
-- RPC: buat rumah tangga + seed menu contoh
-- ------------------------------------------------------------
create or replace function public.create_household(
  p_name text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_code    text;
  v_name    text := coalesce(nullif(trim(p_name), ''), 'Rumah Tangga');
  v_display text := coalesce(
    nullif(trim(p_display_name), ''),
    split_part(coalesce(auth.jwt() ->> 'email', 'Anggota'), '@', 1)
  );
begin
  if auth.uid() is null then
    raise exception 'Kamu harus login dulu.';
  end if;

  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'Akun ini sudah tergabung dalam rumah tangga.';
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.households where invite_code = v_code);
  end loop;

  insert into public.households (name, invite_code)
  values (v_name, v_code)
  returning id into v_id;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (v_id, auth.uid(), v_display, 'owner');

  begin
    perform public.set_access_code(null);
  exception when others then
    raise warning 'Gagal membuat kode akses otomatis: %', sqlerrm;
  end;

  insert into public.menu_items (household_id, name, category, kind, default_amount, sort_order)
  values
    (v_id, 'Tempe Goreng',                    'Masak Kos', 'masak', 3000,  1),
    (v_id, 'Tempe Goreng Tepung',             'Masak Kos', 'masak', 4000,  2),
    (v_id, 'Tempe Orek Kecap',                'Masak Kos', 'masak', 5000,  3),
    (v_id, 'Tahu Goreng',                     'Masak Kos', 'masak', 3000,  4),
    (v_id, 'Tahu Goreng Tepung (Bakwan)',     'Masak Kos', 'masak', 4000,  5),
    (v_id, 'Telur Dadar',                     'Masak Kos', 'masak', 3000,  6),
    (v_id, 'Telur Ceplok',                    'Masak Kos', 'masak', 3000,  7),
    (v_id, 'Omelet',                          'Masak Kos', 'masak', 5000,  8),
    (v_id, 'Mie All Around',                  'Masak Kos', 'masak', 7000,  9),
    (v_id, 'Tahu Kocek Level Max',            'Jajan',     'jajan', 10000, 1),
    (v_id, 'Siwil Petis',                     'Jajan',     'jajan', 10000, 2),
    (v_id, 'Pok Pok',                         'Jajan',     'jajan', 8000,  3),
    (v_id, 'Otak Otak Full Chili Oil',        'Jajan',     'jajan', 12000, 4),
    (v_id, 'Pentol Full Kuah (10k berdua)',   'Jajan',     'jajan', 10000, 5),
    (v_id, 'Gorengan 1k (8-10k berdua)',      'Jajan',     'jajan', 9000,  6),
    (v_id, 'Chuba Buat Kondimen',             'Jajan',     'jajan', 5000,  7);

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- RPC: gabung rumah tangga lewat kode undangan
-- ------------------------------------------------------------
create or replace function public.join_household(
  p_code text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_existing uuid;
  v_display  text := coalesce(
    nullif(trim(p_display_name), ''),
    split_part(coalesce(auth.jwt() ->> 'email', 'Anggota'), '@', 1)
  );
begin
  if auth.uid() is null then
    raise exception 'Kamu harus login dulu.';
  end if;

  select id into v_id
  from public.households
  where invite_code = upper(trim(p_code));

  if v_id is null then
    raise exception 'Kode undangan tidak ditemukan.';
  end if;

  select household_id into v_existing
  from public.household_members
  where user_id = auth.uid()
  limit 1;

  if v_existing is not null then
    if v_existing = v_id then
      return v_id;
    end if;
    raise exception 'Akun ini sudah tergabung di rumah tangga lain. Keluar dulu untuk pindah.';
  end if;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (v_id, auth.uid(), v_display, 'member');

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- RPC: keluar rumah tangga
-- ------------------------------------------------------------
create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid;
begin
  select household_id into v_hid
  from public.household_members
  where user_id = auth.uid()
  limit 1;

  if v_hid is null then
    return;
  end if;

  delete from public.household_access
  where household_id = v_hid
    and owner_user_id = auth.uid();

  delete from public.household_members
  where user_id = auth.uid();

  if not exists (select 1 from public.household_members where household_id = v_hid) then
    delete from public.households where id = v_hid;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- RPC: ubah nama tampilan (cegah eskalasi role lewat update langsung)
-- ------------------------------------------------------------
create or replace function public.update_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.household_members
  set display_name = coalesce(nullif(trim(p_name), ''), 'Anggota')
  where user_id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- RPC: ganti kode undangan
-- ------------------------------------------------------------
create or replace function public.rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid  uuid;
  v_code text;
begin
  select household_id into v_hid
  from public.household_members
  where user_id = auth.uid()
  limit 1;

  if v_hid is null then
    raise exception 'Kamu belum tergabung dalam rumah tangga.';
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.households where invite_code = v_code);
  end loop;

  update public.households set invite_code = v_code where id = v_hid;
  return v_code;
end;
$$;

-- ------------------------------------------------------------
-- RPC: kode akses login tanpa email (khusus owner)
-- ------------------------------------------------------------
create or replace function public.set_access_code(p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hid   uuid;
  v_code  text;
  v_token text;
  v_bytes bytea;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i       integer;
begin
  if auth.uid() is null then
    raise exception 'Kamu harus login dulu.';
  end if;

  select household_id into v_hid
  from public.household_members
  where user_id = auth.uid()
    and role = 'owner'
  limit 1;

  if v_hid is null then
    raise exception 'Hanya owner yang bisa mengatur kode akses.';
  end if;

  if p_code is null or trim(p_code) = '' then
    loop
      v_code := '';
      v_bytes := extensions.gen_random_bytes(5);
      for i in 0..4 loop
        v_code := v_code || substr(v_chars, (get_byte(v_bytes, i) % length(v_chars)) + 1, 1);
      end loop;
      exit when not exists (select 1 from public.household_access where code = v_code);
    end loop;
  else
    v_code := upper(trim(p_code));
    if v_code !~ '^[A-Z0-9]{5}$' then
      raise exception 'Kode harus 5 karakter huruf/angka.';
    end if;
    if exists (
      select 1 from public.household_access
      where code = v_code and household_id <> v_hid
    ) then
      raise exception 'Kode sudah dipakai rumah tangga lain.';
    end if;
  end if;

  loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    exit when not exists (select 1 from public.household_access where token = v_token);
  end loop;

  insert into public.household_access (household_id, code, token, owner_user_id, updated_at)
  values (v_hid, v_code, v_token, auth.uid(), now())
  on conflict (household_id) do update
    set code = excluded.code,
        token = excluded.token,
        owner_user_id = excluded.owner_user_id,
        updated_at = now();

  return jsonb_build_object('code', v_code, 'token', v_token);
end;
$$;

create or replace function public.get_access_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hid uuid;
  v_row public.household_access;
begin
  if auth.uid() is null then
    return null;
  end if;

  select household_id into v_hid
  from public.household_members
  where user_id = auth.uid()
    and role = 'owner'
  limit 1;

  if v_hid is null then
    return null;
  end if;

  select * into v_row
  from public.household_access
  where household_id = v_hid;

  if v_row.household_id is null then
    return null;
  end if;

  return jsonb_build_object('code', v_row.code, 'token', v_row.token);
end;
$$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.entries           enable row level security;
alter table public.menu_items        enable row level security;
alter table public.household_access  enable row level security;
alter table public.access_login_attempts enable row level security;

revoke all on public.household_access from anon, authenticated;
revoke all on public.access_login_attempts from anon, authenticated;

grant select on public.household_members to service_role;
grant select, insert, update, delete on public.household_access to service_role;
grant select, insert, update, delete on public.access_login_attempts to service_role;
grant usage, select on sequence public.access_login_attempts_id_seq to service_role;

-- households
drop policy if exists "households_select_member" on public.households;
create policy "households_select_member"
  on public.households for select
  using (public.is_household_member(id));

drop policy if exists "households_update_member" on public.households;
create policy "households_update_member"
  on public.households for update
  using (public.is_household_member(id))
  with check (public.is_household_member(id));

-- household_members (insert/delete hanya via RPC security definer)
drop policy if exists "members_select_same_household" on public.household_members;
create policy "members_select_same_household"
  on public.household_members for select
  using (public.is_household_member(household_id));

-- entries
drop policy if exists "entries_select_member" on public.entries;
create policy "entries_select_member"
  on public.entries for select
  using (public.is_household_member(household_id));

drop policy if exists "entries_insert_member" on public.entries;
create policy "entries_insert_member"
  on public.entries for insert
  with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists "entries_update_member" on public.entries;
create policy "entries_update_member"
  on public.entries for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "entries_delete_member" on public.entries;
create policy "entries_delete_member"
  on public.entries for delete
  using (public.is_household_member(household_id));

-- menu_items
drop policy if exists "menu_select_member" on public.menu_items;
create policy "menu_select_member"
  on public.menu_items for select
  using (public.is_household_member(household_id));

drop policy if exists "menu_insert_member" on public.menu_items;
create policy "menu_insert_member"
  on public.menu_items for insert
  with check (public.is_household_member(household_id));

drop policy if exists "menu_update_member" on public.menu_items;
create policy "menu_update_member"
  on public.menu_items for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "menu_delete_member" on public.menu_items;
create policy "menu_delete_member"
  on public.menu_items for delete
  using (public.is_household_member(household_id));

-- ------------------------------------------------------------
-- REALTIME (opsional, untuk sinkron antar 2 user)
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.entries;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.menu_items;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- GRANT
-- ------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.entries to authenticated;
grant select, insert, update, delete on public.menu_items to authenticated;
grant select, update on public.households to authenticated;
grant select on public.household_members to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.update_display_name(text) to authenticated;
grant execute on function public.rotate_invite_code() to authenticated;
grant execute on function public.set_access_code(text) to authenticated;
grant execute on function public.get_access_settings() to authenticated;

-- ------------------------------------------------------------
-- BACKFILL: buat kode akses untuk rumah tangga yang sudah ada
-- ------------------------------------------------------------
do $$
declare
  r       record;
  v_code  text;
  v_token text;
  v_bytes bytea;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i       integer;
begin
  for r in
    select distinct on (h.id) h.id, m.user_id as owner_id
    from public.households h
    join public.household_members m
      on m.household_id = h.id
     and m.role = 'owner'
    where not exists (
      select 1 from public.household_access a where a.household_id = h.id
    )
    order by h.id, m.joined_at
  loop
    loop
      v_code := '';
      v_bytes := extensions.gen_random_bytes(5);
      for i in 0..4 loop
        v_code := v_code || substr(v_chars, (get_byte(v_bytes, i) % length(v_chars)) + 1, 1);
      end loop;
      exit when not exists (select 1 from public.household_access where code = v_code);
    end loop;

    loop
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      exit when not exists (select 1 from public.household_access where token = v_token);
    end loop;

    insert into public.household_access (household_id, code, token, owner_user_id, updated_at)
    values (r.id, v_code, v_token, r.owner_id, now());
  end loop;
end $$;

-- Muat ulang schema cache PostgREST agar tabel baru langsung dikenali.
notify pgrst, 'reload schema';
