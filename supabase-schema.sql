create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  phone text,
  created_at timestamptz default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  items jsonb not null,
  subtotal integer not null,
  delivery_location text not null,
  delivery_address text not null,
  delivery_fee integer not null,
  total integer not null,
  contact_method text not null,
  contact_value text not null,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.custom_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  garment text not null,
  color_fabric text,
  bust text,
  waist text,
  hips text,
  crotch_length text,
  height text,
  shoulder text,
  notes text,
  deposit_amount integer not null,
  contact_method text not null,
  contact_value text not null,
  status text default 'pending',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.custom_orders enable row level security;

drop policy if exists "Anyone can create orders" on public.orders;
create policy "Anyone can create orders"
  on public.orders for insert
  with check (true);

drop policy if exists "Users can view their orders" on public.orders;
create policy "Users can view their orders"
  on public.orders for select
  using (user_id = auth.uid());

drop policy if exists "Users can update their orders" on public.orders;
create policy "Users can update their orders"
  on public.orders for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Anyone can create custom orders" on public.custom_orders;
create policy "Anyone can create custom orders"
  on public.custom_orders for insert
  with check (true);

drop policy if exists "Users can view their custom orders" on public.custom_orders;
create policy "Users can view their custom orders"
  on public.custom_orders for select
  using (user_id = auth.uid());

drop policy if exists "Users can update their custom orders" on public.custom_orders;
create policy "Users can update their custom orders"
  on public.custom_orders for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can view their profile" on public.profiles;
create policy "Users can view their profile"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
