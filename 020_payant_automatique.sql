-- =====================================================================
--  GESTION IEPP — Version payante automatique après l'année d'expérimentation
--  • 2026-2027 est la SEULE année d'expérimentation (gratuite).
--  • La gratuité s'arrête automatiquement à la fin de l'année 2026-2027
--    + 1 mois (même délai que les abonnements).
--  • Toutes les années scolaires suivantes sont PAYANTES automatiquement :
--    il est impossible de les marquer « expérimentation ».
--  À lancer APRÈS 019. Peut être relancé sans risque.
-- =====================================================================

-- 1. Seule une année commençant avant juillet 2027 (donc 2026-2027) peut être gratuite
create or replace function verifier_experimentation() returns trigger
language plpgsql as $$
begin
  if new.experimentation and new.date_debut >= date '2027-07-01' then
    raise exception 'Les années scolaires à partir de 2027-2028 sont payantes : l''année d''expérimentation était 2026-2027.';
  end if;
  return new;
end $$;
drop trigger if exists verifier_experimentation on annees_scolaires;
create trigger verifier_experimentation before insert or update of experimentation, date_debut on annees_scolaires
  for each row execute function verifier_experimentation();

update annees_scolaires set experimentation = false where experimentation and date_debut >= date '2027-07-01';

-- 2. Gratuité seulement jusqu'à la fin de l'année d'expérimentation + 1 mois
create or replace function abonnement_actif(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from annees_scolaires s
            where s.active and s.experimentation
              and current_date <= (s.date_fin + interval '1 month')::date
         )
      or exists (
        select 1 from abonnements a
          join annees_scolaires s on s.id = a.annee_id and s.active
         where a.iepp_id = p_iepp and a.statut = 'valide'
           and current_date <= coalesce(fin_abonnement(s.id), (s.date_fin + interval '1 month')::date)
      )
$$;
grant execute on function abonnement_actif(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'Gratuit jusqu''au ' || to_char((date_fin + interval '1 month')::date, 'DD/MM/YYYY')
       || ', puis payant automatiquement' as resultat
  from annees_scolaires where experimentation;
