-- =====================================================================
--  GESTION IEPP — Abonnement payant par année scolaire
--  Chaque circonscription (IEPP) paie son abonnement pour l'année active
--  (Orange Money, MTN, Moov, Wave, espèces…). Le superviseur valide le
--  paiement ; sans abonnement validé, l'accès de l'IEPP est bloqué.
--  À coller dans Supabase > SQL Editor > New query, puis Run.
--  Peut être relancé sans risque.
-- =====================================================================

-- 1. Tarif et instructions de paiement (une seule ligne)
create table if not exists config_abonnement (
  id            smallint primary key default 1 check (id = 1),
  montant       numeric(12,0) not null default 50000,
  devise        text not null default 'FCFA',
  instructions  text not null default 'Envoyez le montant par Orange Money, MTN MoMo, Moov Money ou Wave au numéro indiqué par le gestionnaire, puis déclarez votre paiement ci-dessous avec la référence de la transaction.',
  contact       text,
  updated_at    timestamptz not null default now()
);
insert into config_abonnement (id) values (1) on conflict (id) do nothing;

-- 2. Abonnements (un par IEPP et par année scolaire)
create table if not exists abonnements (
  id             uuid primary key default gen_random_uuid(),
  iepp_id        uuid not null references iepp(id) on delete cascade,
  annee_id       uuid not null references annees_scolaires(id) on delete cascade,
  montant        numeric(12,0) not null default 0,
  mode           text not null default 'orange_money'
                 check (mode in ('orange_money', 'mtn_momo', 'moov_money', 'wave', 'especes', 'virement', 'gratuit')),
  reference      text,
  telephone      text,
  date_paiement  date default current_date,
  statut         text not null default 'en_attente' check (statut in ('en_attente', 'valide', 'refuse')),
  observations   text,
  declare_par    uuid default auth.uid(),
  valide_par     uuid,
  valide_le      timestamptz,
  created_at     timestamptz not null default now(),
  unique (iepp_id, annee_id)
);

alter table config_abonnement enable row level security;
alter table abonnements enable row level security;

drop policy if exists config_abonnement_lecture on config_abonnement;
drop policy if exists config_abonnement_ecriture on config_abonnement;
create policy config_abonnement_lecture on config_abonnement for select to authenticated using (true);
create policy config_abonnement_ecriture on config_abonnement for all to authenticated
  using (est_superviseur()) with check (est_superviseur());

drop policy if exists abonnements_lecture on abonnements;
drop policy if exists abonnements_declaration on abonnements;
drop policy if exists abonnements_redeclaration on abonnements;
drop policy if exists abonnements_superviseur on abonnements;
-- Lecture : le superviseur voit tout, chaque utilisateur voit l'abonnement de son IEPP
create policy abonnements_lecture on abonnements for select to authenticated
  using (est_superviseur() or iepp_id = mon_iepp());
-- L'inspecteur déclare un paiement pour son IEPP (toujours « en attente »)
create policy abonnements_declaration on abonnements for insert to authenticated
  with check (est_superviseur() or (mon_role() = 'iepp' and iepp_id = mon_iepp() and statut = 'en_attente'));
-- L'inspecteur peut corriger une déclaration en attente ou refusée (elle repasse en attente)
create policy abonnements_redeclaration on abonnements for update to authenticated
  using (mon_role() = 'iepp' and iepp_id = mon_iepp() and statut <> 'valide')
  with check (mon_role() = 'iepp' and iepp_id = mon_iepp() and statut = 'en_attente');
-- Le superviseur valide, refuse, modifie, supprime
create policy abonnements_superviseur on abonnements for all to authenticated
  using (est_superviseur()) with check (est_superviseur());

grant select, insert, update, delete on config_abonnement, abonnements to authenticated, service_role;

-- 3. L'IEPP a-t-elle un abonnement validé pour l'année active ?
create or replace function abonnement_actif(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from abonnements a
      join annees_scolaires s on s.id = a.annee_id and s.active
     where a.iepp_id = p_iepp and a.statut = 'valide'
  )
$$;
grant execute on function abonnement_actif(uuid) to authenticated;

-- 4. Le superviseur garde l'accès à ses propres circonscriptions de test :
--    rien à faire, le superviseur n'est jamais bloqué.

select 'Abonnements installés' as resultat;
