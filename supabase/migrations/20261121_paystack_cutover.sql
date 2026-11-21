-- RUN ONLY at Paystack checkout cutover, when the new storefront and functions are deployed.
-- Prevent browsers from writing or editing payment/order statuses without verification.
drop policy if exists "Anyone can create orders" on public.orders;
drop policy if exists "Users can update their orders" on public.orders;
drop policy if exists "Anyone can create custom orders" on public.custom_orders;
drop policy if exists "Users can update their custom orders" on public.custom_orders;
-- Keep existing select policies so signed-in customers can view orders.
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.custom_orders from anon, authenticated;
