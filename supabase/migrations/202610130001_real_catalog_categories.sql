-- Brutti Catalog production category setup and safe draft staging.
-- Run ONLY in a dedicated Brutti Catalog Supabase project, after phase-one schema.
-- Re-running is safe and does not overwrite changes to existing categories or products.
begin;

insert into public.categories (id, name, description) values
('30000000-0000-4000-8000-000000000001', 'Racks & Shelves',
 'Shelving units, wardrobes, storage racks and custom organisers.'),
('30000000-0000-4000-8000-000000000002', 'Tables & Kitchen Counters',
 'Dining tables, study desks, kitchen islands and preparation counters.'),
('30000000-0000-4000-8000-000000000003', 'Displays & Panels',
 'Custom display structures, wall panels and decorative installations.'),
('30000000-0000-4000-8000-000000000004', 'Beds & Bunk Beds',
 'Bed frames, daybeds, bunk beds and custom sleeping furniture.'),
('30000000-0000-4000-8000-000000000005', 'Reception Counters',
 'Reception desks, cashier counters and front-of-house service counters.'),
('30000000-0000-4000-8000-000000000006', 'Displays & Mementos',
 'Custom tabletop displays, plaques, awards, souvenirs and mementos.'),
('30000000-0000-4000-8000-000000000007', 'Rentals',
 'Furniture, kiosks and display pieces available for event rental.')
on conflict (id) do nothing;

-- A draft may have unknown sizes in the 2025 PDF. Zero means "not verified".
-- Publishing still requires positive dimensions, description, materials, and photos.
alter table public.products drop constraint if exists products_width_check;
alter table public.products drop constraint if exists products_depth_check;
alter table public.products drop constraint if exists products_height_check;
alter table public.products add constraint products_width_check
  check (width >= 0 and width < 100000);
alter table public.products add constraint products_depth_check
  check (depth >= 0 and depth < 100000);
alter table public.products add constraint products_height_check
  check (height >= 0 and height < 100000);

alter table public.products drop constraint if exists published_product_is_complete;
alter table public.products add constraint published_product_is_complete check (
  status <> 'published'
  or (
    width > 0 and depth > 0 and height > 0
    and char_length(btrim(description)) > 0
    and char_length(btrim(materials)) > 0
    and jsonb_array_length(images) > 0
  )
);

commit;
