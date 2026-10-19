-- =====================================================================
--  GESTION IEPP — Durée de l'abonnement = l'année scolaire en cours
--  • Une IEPP peut s'abonner à tout moment de l'année scolaire.
--  • Quel que soit le jour du paiement, l'accès dure jusqu'à la date de
--    FIN de l'année scolaire active (Paramétrage → Années scolaires) PLUS 1 MOIS.
--  • Une « date de fin précise » peut remplacer cette date
--    (Abonnements → Tarif et instructions) ; vide = fin de l'année scolaire + 1 mois.
--  À lancer APRÈS 005. Peut être relancé sans risque.
-- =====================================================================

alter table config_abonnement add column if not exists date_fin date;
update config_abonnement set date_fin = null where id = 1;

-- Date de fin d'abonnement : date précise si renseignée, sinon fin de l'année scolaire + 1 mois
create or replace function fin_abonnement(p_annee uuid) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(c.date_fin, (s.date_fin + interval '1 month')::date)
    from annees_scolaires s left join config_abonnement c on c.id = 1
   where s.id = p_annee
$$;

-- Abonnement valide ET date de fin non dépassée
create or replace function abonnement_actif(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from abonnements a
      join annees_scolaires s on s.id = a.annee_id and s.active
     where a.iepp_id = p_iepp and a.statut = 'valide'
       and current_date <= coalesce(fin_abonnement(s.id), (s.date_fin + interval '1 month')::date)
  )
$$;
grant execute on function fin_abonnement(uuid), abonnement_actif(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Abonnements ' || libelle || ' valables jusqu''au ' || to_char(fin_abonnement(id), 'DD/MM/YYYY') as resultat
  from annees_scolaires where active;
