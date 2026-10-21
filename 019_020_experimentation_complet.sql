-- GESTION IEPP — Année d'expérimentation 2026-2027 puis payant automatique (script complet)
alter table config_abonnement add column if not exists date_fin date;
alter table annees_scolaires add column if not exists experimentation boolean not null default false;

create or replace function fin_abonnement(p_annee uuid) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(c.date_fin, (s.date_fin + interval '1 month')::date)
    from annees_scolaires s left join config_abonnement c on c.id = 1
   where s.id = p_annee
$$;

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

update annees_scolaires set experimentation = true where active and date_debut < date '2027-07-01';

create or replace function abonnement_actif(p_iepp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from annees_scolaires s
            where s.active and s.experimentation
              and current_date <= (s.date_fin + interval '1 month')::date)
      or exists (
           select 1 from abonnements a
             join annees_scolaires s on s.id = a.annee_id and s.active
            where a.iepp_id = p_iepp and a.statut = 'valide'
              and current_date <= coalesce(fin_abonnement(s.id), (s.date_fin + interval '1 month')::date))
$$;
grant execute on function fin_abonnement(uuid), abonnement_actif(uuid) to authenticated;

notify pgrst, 'reload schema';
select libelle || ' : gratuit jusqu''au ' || to_char((date_fin + interval '1 month')::date, 'DD/MM/YYYY') || ', puis payant automatiquement' as resultat
  from annees_scolaires where experimentation;
