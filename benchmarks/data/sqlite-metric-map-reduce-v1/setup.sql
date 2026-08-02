CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  region TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
) STRICT;

INSERT INTO orders (region, status, amount_cents) VALUES
  ('north', 'paid', 31),
  ('north', 'paid', 19),
  ('south', 'paid', 26),
  ('east', 'paid', 14),
  ('north', 'refunded', 7),
  ('south', 'refunded', 5),
  ('east', 'pending', 8);
