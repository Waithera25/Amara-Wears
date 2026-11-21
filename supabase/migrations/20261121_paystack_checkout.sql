-- Apply this migration BEFORE deploying or enabling Paystack checkout.
-- Safe preliminary migration: adds catalog, pricing and payment fields.\n-- Existing checkout permissions remain intact until the Paystack cutover.\n-- Run the separate 20261121_paystack_cutover.sql ONLY when the new checkout is ready.
create table if not exists public.katawa_catalog (
  id integer primary key,
  name text not null,
  price_kes integer not null check (price_kes > 0),
  sizes text[] not null,
  sold_out text[] not null default '{}',
  active boolean not null default true
);
create table if not exists public.katawa_custom_prices (
  garment text primary key,
  price_kes integer not null check (price_kes > 0),
  active boolean not null default true
);
alter table public.katawa_catalog enable row level security;
alter table public.katawa_custom_prices enable row level security;
-- No browser policies: only backend functions may read authoritative prices via service role.

alter table public.orders
  add column if not exists customer_email text,
  add column if not exists payment_provider text,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_reference text;
alter table public.custom_orders
  add column if not exists customer_email text,
  add column if not exists payment_provider text,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_reference text;
create unique index if not exists orders_payment_reference_uq on public.orders(payment_reference);
create unique index if not exists custom_orders_payment_reference_uq on public.custom_orders(payment_reference);

-- Prices seeded from current index.html; update BOTH site and catalog when changing prices.
insert into public.katawa_catalog (id,name,price_kes,sizes,sold_out,active) values
(1,'Nia Top & Wrap Skirt Set',4800,ARRAY['S','M','L','XL']::text[],ARRAY[]::text[],true),
(2,'Zawadi Two-Piece Set',5600,ARRAY['S','M','L','XL']::text[],ARRAY['S']::text[],true),
(3,'Bahati Crop & Maxi Set',5200,ARRAY['S','M','L']::text[],ARRAY[]::text[],true),
(4,'Asha Pleated Midi Skirt',2800,ARRAY['S','M','L','XL']::text[],ARRAY[]::text[],true),
(5,'Tamu Satin Midi Skirt',3100,ARRAY['S','M','L']::text[],ARRAY['L']::text[],true),
(6,'Imani Flowing Long Skirt',3400,ARRAY['S','M','L','XL']::text[],ARRAY[]::text[],true),
(7,'Zuri Wrap Long Skirt',3600,ARRAY['M','L','XL']::text[],ARRAY[]::text[],true),
(8,'Furaha Blouse Top',2200,ARRAY['S','M','L','XL']::text[],ARRAY[]::text[],true),
(9,'Sauti Wrap Top',2000,ARRAY['S','M','L']::text[],ARRAY[]::text[],true),
(10,'Nadia Wrap Dress',4600,ARRAY['S','M','L','XL']::text[],ARRAY[]::text[],true),
(11,'Amani Shirt Dress',4200,ARRAY['S','M','L']::text[],ARRAY['S']::text[],true)
on conflict (id) do update set name=excluded.name, price_kes=excluded.price_kes,
  sizes=excluded.sizes, sold_out=excluded.sold_out, active=excluded.active;
insert into public.katawa_custom_prices (garment, price_kes) values
('Two-Piece Set', 5200),('Midi Skirt', 2900),('Long Skirt', 3400),
('Top', 2200),('Dress', 4600)
on conflict (garment) do update set price_kes=excluded.price_kes;
