-- =====================================================
-- LOTUS FIDELIDADE | estrutura do banco (Supabase)
-- Rodar no SQL Editor. Testar antes num projeto de teste.
-- =====================================================

create extension if not exists unaccent;

-- -----------------------------------------------------
-- 1. CONFIGURACAO (uma linha so, editavel pelo admin)
-- -----------------------------------------------------
create table public.config (
  id int primary key default 1 check (id = 1),
  pontos_por_real numeric(10,2) not null default 10,  -- R$ 1 = 10 pontos
  pontos_por_resgate int not null default 1000,       -- bloco de resgate
  reais_por_resgate numeric(10,2) not null default 5, -- 1000 pontos = R$ 5
  validade_meses int not null default 6
);
insert into public.config default values;

-- -----------------------------------------------------
-- 2. EQUIPE DO BALCAO
-- -----------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- -----------------------------------------------------
-- 3. CLIENTES
-- -----------------------------------------------------
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null unique check (telefone ~ '^[0-9]{10,11}$'),
  aceite_marketing boolean not null default false,
  aceite_em timestamptz,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------
-- 4. MOVIMENTACOES (extrato; saldo = soma dos pontos)
-- -----------------------------------------------------
create table public.movimentacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo text not null check (tipo in ('compra','resgate','ajuste','expiracao')),
  valor_compra numeric(10,2),
  pontos int not null,
  observacao text,
  lancado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.movimentacoes (cliente_id, created_at desc);

-- -----------------------------------------------------
-- 5. SALDO (validade renovavel: conta da ultima compra)
-- -----------------------------------------------------
create or replace function public.saldo_cliente(p_cliente_id uuid)
returns table (saldo int, ultima_compra timestamptz, expira_em timestamptz)
language sql stable security definer set search_path = public as $$
  with base as (
    select coalesce(sum(m.pontos), 0)::int as total,
           max(m.created_at) filter (where m.tipo = 'compra') as ultima
    from public.movimentacoes m
    where m.cliente_id = p_cliente_id
  ),
  cfg as (select validade_meses from public.config where id = 1)
  select
    case
      when b.ultima is null then 0
      when b.ultima + make_interval(months => c.validade_meses) < now() then 0
      else greatest(b.total, 0)
    end,
    b.ultima,
    b.ultima + make_interval(months => c.validade_meses)
  from base b, cfg c;
$$;

-- -----------------------------------------------------
-- 6. CADASTRO PUBLICO (tela do QR code)
-- -----------------------------------------------------
create or replace function public.cadastrar_cliente(
  p_nome text, p_telefone text, p_aceite boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if length(v_nome) < 3 or position(' ' in v_nome) = 0 then
    raise exception 'Informe o nome completo';
  end if;
  if v_tel !~ '^[0-9]{10,11}$' then
    raise exception 'Telefone invalido';
  end if;
  if exists (select 1 from public.clientes where telefone = v_tel) then
    raise exception 'Telefone ja cadastrado';
  end if;

  insert into public.clientes (nome, telefone, aceite_marketing, aceite_em)
  values (v_nome, v_tel, coalesce(p_aceite, false),
          case when p_aceite then now() end)
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------
-- 7. CONSULTA PUBLICA (area do cliente: nome + telefone)
-- -----------------------------------------------------
create or replace function public.consultar_pontos(p_nome text, p_telefone text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_cli public.clientes;
  v_cfg public.config;
  v_s record;
begin
  select * into v_cli
  from public.clientes
  where telefone = v_tel
    and lower(unaccent(regexp_replace(trim(nome), '\s+', ' ', 'g')))
      = lower(unaccent(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g')));

  if not found then
    return null;
  end if;

  select * into v_cfg from public.config where id = 1;
  select * into v_s from public.saldo_cliente(v_cli.id);

  return json_build_object(
    'primeiro_nome', split_part(v_cli.nome, ' ', 1),
    'saldo_pontos', v_s.saldo,
    'saldo_resgatavel_reais',
      floor(v_s.saldo::numeric / v_cfg.pontos_por_resgate) * v_cfg.reais_por_resgate,
    'pontos_no_bloco_atual', v_s.saldo % v_cfg.pontos_por_resgate,
    'pontos_por_bloco', v_cfg.pontos_por_resgate,
    'reais_por_bloco', v_cfg.reais_por_resgate,
    'expira_em', case when v_s.saldo > 0 then v_s.expira_em end,
    'historico', (
      select coalesce(json_agg(h), '[]'::json)
      from (
        select tipo, valor_compra, pontos, created_at
        from public.movimentacoes
        where cliente_id = v_cli.id
        order by created_at desc
        limit 20
      ) h
    )
  );
end;
$$;

-- -----------------------------------------------------
-- 7b. REGRAS DO PROGRAMA (texto da tela de cadastro)
-- -----------------------------------------------------
create or replace function public.regras_programa()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'pontos_por_real', pontos_por_real,
    'pontos_por_bloco', pontos_por_resgate,
    'reais_por_bloco', reais_por_resgate,
    'validade_meses', validade_meses
  ) from public.config where id = 1;
$$;

-- -----------------------------------------------------
-- 8. LANCAR COMPRA (so balcao)
-- -----------------------------------------------------
create or replace function public.registrar_compra(
  p_cliente_id uuid, p_valor numeric, p_obs text default null
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cfg public.config;
  v_bruto int;
  v_ultima timestamptz;
  v_pontos int;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'Valor invalido';
  end if;

  -- trava o cliente pra evitar dois lancamentos simultaneos
  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente nao encontrado';
  end if;

  select * into v_cfg from public.config where id = 1;

  select coalesce(sum(pontos), 0), max(created_at) filter (where tipo = 'compra')
    into v_bruto, v_ultima
  from public.movimentacoes
  where cliente_id = p_cliente_id;

  -- se o saldo antigo venceu, zera antes de lancar a compra nova
  if v_ultima is not null and v_bruto > 0
     and v_ultima + make_interval(months => v_cfg.validade_meses) < now() then
    insert into public.movimentacoes (cliente_id, tipo, pontos, observacao, lancado_por)
    values (p_cliente_id, 'expiracao', -v_bruto, 'Pontos expirados', auth.uid());
  end if;

  v_pontos := floor(p_valor * v_cfg.pontos_por_real);

  insert into public.movimentacoes
    (cliente_id, tipo, valor_compra, pontos, observacao, lancado_por)
  values
    (p_cliente_id, 'compra', p_valor, v_pontos, p_obs, auth.uid());

  return v_pontos;
end;
$$;

-- -----------------------------------------------------
-- 9. RESGATE (so balcao, em blocos)
-- -----------------------------------------------------
create or replace function public.registrar_resgate(p_cliente_id uuid, p_blocos int)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_cfg public.config;
  v_saldo int;
  v_pontos int;
  v_reais numeric;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  if p_blocos is null or p_blocos < 1 then
    raise exception 'Quantidade invalida';
  end if;

  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente nao encontrado';
  end if;

  select * into v_cfg from public.config where id = 1;
  select saldo into v_saldo from public.saldo_cliente(p_cliente_id);

  v_pontos := p_blocos * v_cfg.pontos_por_resgate;
  v_reais := p_blocos * v_cfg.reais_por_resgate;

  if v_saldo < v_pontos then
    raise exception 'Saldo insuficiente';
  end if;

  insert into public.movimentacoes (cliente_id, tipo, pontos, observacao, lancado_por)
  values (p_cliente_id, 'resgate', -v_pontos,
          'Resgate de R$ ' || to_char(v_reais, 'FM999990.00'), auth.uid());

  return v_reais;
end;
$$;

-- -----------------------------------------------------
-- 10. PAINEL DO ADMIN (lista + base pra campanha)
-- -----------------------------------------------------
create or replace view public.painel_clientes
with (security_invoker = true) as
select
  c.id, c.nome, c.telefone, c.aceite_marketing, c.created_at,
  s.saldo, s.ultima_compra, s.expira_em,
  (select count(*) from public.movimentacoes m
    where m.cliente_id = c.id and m.tipo = 'compra') as qtd_compras,
  (select coalesce(sum(m.valor_compra), 0) from public.movimentacoes m
    where m.cliente_id = c.id and m.tipo = 'compra') as total_gasto
from public.clientes c
cross join lateral public.saldo_cliente(c.id) s;

-- -----------------------------------------------------
-- 11. SEGURANCA (RLS)
-- Ninguem de fora le tabela direto. Cliente so usa as
-- funcoes de cadastro e consulta. Insercao de pontos
-- so pelas funcoes, entao o extrato nao pode ser editado.
-- -----------------------------------------------------
alter table public.config        enable row level security;
alter table public.admins        enable row level security;
alter table public.clientes      enable row level security;
alter table public.movimentacoes enable row level security;

create policy "admin le config" on public.config
  for select to authenticated using (public.is_admin());
create policy "admin edita config" on public.config
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin le admins" on public.admins
  for select to authenticated using (public.is_admin());

create policy "admin le clientes" on public.clientes
  for select to authenticated using (public.is_admin());
create policy "admin edita clientes" on public.clientes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin le movimentacoes" on public.movimentacoes
  for select to authenticated using (public.is_admin());

-- Permissoes das funcoes
revoke execute on function public.is_admin() from public;
revoke execute on function public.saldo_cliente(uuid) from public;
revoke execute on function public.cadastrar_cliente(text, text, boolean) from public;
revoke execute on function public.consultar_pontos(text, text) from public;
revoke execute on function public.regras_programa() from public;
revoke execute on function public.registrar_compra(uuid, numeric, text) from public;
revoke execute on function public.registrar_resgate(uuid, int) from public;

grant execute on function public.cadastrar_cliente(text, text, boolean) to anon, authenticated;
grant execute on function public.consultar_pontos(text, text) to anon, authenticated;
grant execute on function public.regras_programa() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.saldo_cliente(uuid) to authenticated;
grant execute on function public.registrar_compra(uuid, numeric, text) to authenticated;
grant execute on function public.registrar_resgate(uuid, int) to authenticated;

-- -----------------------------------------------------
-- 12. PRIMEIRO ACESSO DO BALCAO
-- Crie o usuario em Authentication > Users, copie o UID
-- e rode:
-- insert into public.admins (user_id, nome) values ('UID_AQUI', 'Balcao Lotus');
-- -----------------------------------------------------
