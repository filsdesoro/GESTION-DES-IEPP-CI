-- =====================================================================
--  GESTION IEPP — Année d'expérimentation (accès gratuit)
--  Pendant une année scolaire marquée « année d'expérimentation », toutes
--  les circonscriptions utilisent le logiciel GRATUITEMENT : aucun
--  abonnement, aucun ID de paiement ni code d'activation n'est demandé.
--  L'année active (2026-2027) est marquée « expérimentation ».
--  Pour l'arrêter : Abonnements → décocher « Année d'expérimentation »,
--  ou Paramétrage → Années scolaires → Modifier.
--  À lancer APRÈS 014. Peut être relancé sans risque.
-- =====================================================================

alter table annees_scolaires add column if not exists experimentation boolean not null default false;

-- L'année scolaire active devient l'année d'expérimentation
update annees_scolaires set experimentation = true where active;

-- Accès autorisé : année d'expérimentation, OU abonnement validé et non expiré
create or replace function abonnement_actif(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from annees_scolaires s where s.active and s.experimentation)
      or exists (
        select 1 from abonnements a
          join annees_scolaires s on s.id = a.annee_id and s.active
         where a.iepp_id = p_iepp and a.statut = 'valide'
           and current_date <= coalesce(fin_abonnement(s.id), (s.date_fin + interval '1 month')::date)
      )
$$;
grant execute on function abonnement_actif(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Année d''expérimentation : ' || libelle || ' (accès gratuit pour toutes les IEPP)' as resultat
  from annees_scolaires where active and experimentation;
