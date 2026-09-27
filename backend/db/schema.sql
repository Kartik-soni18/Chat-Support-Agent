drop table if exists reviews;
drop table if exists customers;

create table customers (
  client_id       text primary key,
  name            text not null,
  total_orders    int  not null check (total_orders >= 0),
  problem_orders  int  not null default 0,
  flagged_reports int  not null default 0,
  created_at      timestamptz not null default now(),
  check (flagged_reports between 0 and problem_orders),
  check (problem_orders between 0 and total_orders)
);

create table reviews (
  chat_id    uuid primary key,
  client_id  text not null references customers,
  verdict    text not null check (verdict in ('genuine', 'fake', 'low_confidence')),
  created_at timestamptz not null default now()
);

't read or write anything.
't apply to.
alter table customers enable row level security;
alter table reviews enable row level security;

insert into customers (client_id, name, total_orders, problem_orders, flagged_reports) values
  ('CUST-1001', 'Aarav Sharma',  142,  3, 0),
  ('CUST-1002', 'Priya Nair',     57,  4, 0),
  ('CUST-1003', 'Rohan Mehta',    12,  1, 0),
  ('CUST-1004', 'Sneha Iyer',      1,  0, 0),
  ('CUST-1005', 'Vikram Rao',     38,  9, 2),
  ('CUST-1006', 'Kabir Singh',    25, 14, 8),
  ('CUST-1007', 'Ananya Das',    210, 20, 1),
  ('CUST-1008', 'Imran Qureshi',   9,  6, 5);
