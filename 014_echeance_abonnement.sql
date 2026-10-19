-- =====================================================================
--  GESTION IEPP — Période d'abonnement : du 10/10 au 10/10 (modifiable)
--  L'abonnement de l'année scolaire N-(N+1) court du 10 octobre N au 10 octobre N+1
--  (ex. du 10/10/2026 au 10/10/2027 ; jour et mois réglables dans
--  Abonnements → Tarif et instructions).
--  Après cette date, l'accès de l'IEPP est bloqué jusqu'au renouvellement.
--  À lancer APRÈS 005. Peut être relancé sans risque.
-- =====================================================================

alter table config_abonnement add column if not exists echeance_jour smallint not null default 10 check (echeance_jour between 1 and 31);
alter table config_abonnement add column if not exists echeance_mois smallint not null default 10 check (echeance_mois between 1 and 12);

-- Date anniversaire : le 10/10
update config_abonnement set echeance_jour = 10, echeance_mois = 10 where id = 1;

-- Date de fin d'abonnement pour une année scolaire (jour/mois de la config, l'année suivant la rentrée)
create or replace function fin_abonnement(p_annee uuid) returns date
language sql stable security definer set search_path = public as $$
  select make_date(extract(year from s.date_debut)::int + 1, c.echeance_mois,
                   least(c.echeance_jour::int, extract(day from (date_trunc('month', make_date(extract(year from s.date_debut)::int + 1, c.echeance_mois, 1)) + interval '1 month - 1 day'))::int))
    from annees_scolaires s, config_abonnement c
   where s.id = p_annee and c.id = 1
$$;

-- Abonnement valide ET date de fin non dépassée
create or replace function abonnement_actif(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from abonnements a
      join annees_scolaires s on s.id = a.annee_id and s.active
     where a.iepp_id = p_iepp and a.statut = 'valide'
       and current_date <= coalesce(fin_abonnement(s.id), s.date_fin)
  )
$$;
grant execute on function fin_abonnement(uuid), abonnement_actif(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Abonnements du ' || to_char(fin_abonnement(id) - interval '1 year', 'DD/MM/YYYY') || ' au ' || to_char(fin_abonnement(id), 'DD/MM/YYYY') as resultat from annees_scolaires where active;
