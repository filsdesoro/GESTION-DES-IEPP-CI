-- =====================================================================
--  GESTION IEPP — Code d'activation annuel (à usage unique)
--  1. L'inspecteur saisit l'ID de paiement → paiement confirmé (statut « payé »)
--     et un code d'activation unique est généré (ex. IEPP-7K4P-92QX).
--  2. Le code s'affiche automatiquement à l'inspecteur (et au superviseur).
--  3. L'inspecteur saisit ce code → l'accès est ouvert pour l'année scolaire.
--     Le code ne sert qu'une seule fois.
--  À lancer APRÈS 005 et 006. Peut être relancé sans risque.
-- =====================================================================

-- 1. Nouvelles colonnes et nouvel état « payé » (code généré, pas encore utilisé)
alter table abonnements add column if not exists code_activation text;
alter table abonnements add column if not exists code_utilise_le timestamptz;
alter table abonnements drop constraint if exists abonnements_statut_check;
alter table abonnements add constraint abonnements_statut_check check (statut in ('en_attente', 'paye', 'valide', 'refuse'));
create unique index if not exists abonnements_code_unique on abonnements (norm_ref(code_activation)) where code_activation is not null;

-- 2. Génération d'un code lisible : IEPP-XXXX-XXXX (sans 0/O ni 1/I pour éviter les confusions)
create or replace function generer_code_activation() returns text
language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := 'IEPP-';
    for i in 1..8 loop
      c := c || substr(alphabet, 1 + floor(random() * 32)::int, 1);
      if i = 4 then c := c || '-'; end if;
    end loop;
    exit when not exists (select 1 from abonnements where norm_ref(code_activation) = norm_ref(c));
  end loop;
  return c;
end $$;

-- 3. Tout abonnement qui passe à « payé » reçoit automatiquement son code
create or replace function abonnement_code_auto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'paye' and (tg_op = 'INSERT' or old.statut is distinct from 'paye' or new.code_activation is null) then
    new.code_activation := generer_code_activation();
    new.code_utilise_le := null;
  end if;
  return new;
end $$;
drop trigger if exists abonnement_code_auto on abonnements;
create trigger abonnement_code_auto before insert or update on abonnements
  for each row execute function abonnement_code_auto();

-- 4. Saisie de l'ID de paiement : un ID reconnu donne le statut « payé » (et donc un code)
create or replace function activer_abonnement(p_reference text, p_mode text default 'moov_money', p_telephone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_ref    text := norm_ref(p_reference);
  v_iepp   uuid := mon_iepp();
  v_annee  uuid;
  v_tarif  numeric;
  v_p      paiements_recus%rowtype;
  v_abo    abonnements%rowtype;
begin
  if mon_role() is distinct from 'iepp' or v_iepp is null then
    raise exception 'Seul l''inspecteur (compte IEPP) peut activer l''abonnement.';
  end if;
  if v_ref is null then
    raise exception 'Saisissez l''ID de la transaction reçu par SMS.';
  end if;
  select id into v_annee from annees_scolaires where active;
  if v_annee is null then
    raise exception 'Aucune année scolaire active.';
  end if;
  select * into v_abo from abonnements where iepp_id = v_iepp and annee_id = v_annee;
  if found and v_abo.statut = 'valide' then return 'deja_actif'; end if;
  if found and v_abo.statut = 'paye' then return 'code'; end if;
  if exists (select 1 from abonnements where norm_ref(reference) = v_ref and not (iepp_id = v_iepp and annee_id = v_annee)) then
    raise exception 'Cet ID a déjà été utilisé pour activer un abonnement. Un ID ne peut servir qu''une seule fois.';
  end if;
  select montant into v_tarif from config_abonnement where id = 1;

  select * into v_p from paiements_recus where norm_ref(reference) = v_ref for update;
  if found then
    if v_p.utilise_le is not null then
      raise exception 'Cet ID a déjà été utilisé pour activer un abonnement. Un ID ne peut servir qu''une seule fois.';
    end if;
    if v_p.montant is not null and v_tarif is not null and v_p.montant < v_tarif then
      raise exception 'Montant reçu insuffisant : % FCFA au lieu de % FCFA. Contactez le gestionnaire.', v_p.montant, v_tarif;
    end if;
    update paiements_recus set utilise_iepp = v_iepp, utilise_annee = v_annee, utilise_le = now() where id = v_p.id;
    insert into abonnements (iepp_id, annee_id, montant, mode, reference, telephone, date_paiement, statut, valide_le, declare_par)
    values (v_iepp, v_annee, coalesce(v_p.montant, v_tarif, 0), v_p.mode, p_reference, coalesce(p_telephone, v_p.telephone),
            coalesce(v_p.date_reception, current_date), 'paye', now(), auth.uid())
    on conflict (iepp_id, annee_id) do update set
      montant = excluded.montant, mode = excluded.mode, reference = excluded.reference, telephone = excluded.telephone,
      date_paiement = excluded.date_paiement, statut = 'paye', observations = null, valide_le = now();
    return 'code';
  end if;

  insert into abonnements (iepp_id, annee_id, montant, mode, reference, telephone, statut, declare_par)
  values (v_iepp, v_annee, coalesce(v_tarif, 0), coalesce(p_mode, 'moov_money'), p_reference, p_telephone, 'en_attente', auth.uid())
  on conflict (iepp_id, annee_id) do update set
    mode = excluded.mode, reference = excluded.reference, telephone = excluded.telephone,
    statut = 'en_attente', observations = null, date_paiement = current_date;
  return 'en_attente';
end $$;
grant execute on function activer_abonnement(text, text, text) to authenticated;

-- 5. ID enregistré par le superviseur après la saisie de l'IEPP : statut « payé » + code
create or replace function paiement_recu_apres_ajout() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_abo abonnements%rowtype; v_tarif numeric;
begin
  if new.utilise_le is not null then return new; end if;
  select * into v_abo from abonnements
   where norm_ref(reference) = norm_ref(new.reference) and statut in ('en_attente', 'refuse')
   order by created_at desc limit 1;
  if not found then return new; end if;
  select montant into v_tarif from config_abonnement where id = 1;
  if new.montant is not null and v_tarif is not null and new.montant < v_tarif then return new; end if;
  update abonnements set statut = 'paye', valide_le = now(), valide_par = auth.uid(), observations = null,
         montant = coalesce(new.montant, montant), mode = new.mode
   where id = v_abo.id;
  update paiements_recus set utilise_iepp = v_abo.iepp_id, utilise_annee = v_abo.annee_id, utilise_le = now() where id = new.id;
  return new;
end $$;

-- 6. Saisie du code d'activation par l'inspecteur : ouverture de l'accès (une seule fois)
create or replace function utiliser_code_activation(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_iepp  uuid := mon_iepp();
  v_annee uuid;
  v_abo   abonnements%rowtype;
begin
  if mon_role() is distinct from 'iepp' or v_iepp is null then
    raise exception 'Seul l''inspecteur (compte IEPP) peut saisir le code d''activation.';
  end if;
  if norm_ref(p_code) is null then
    raise exception 'Saisissez le code d''activation.';
  end if;
  select id into v_annee from annees_scolaires where active;
  select * into v_abo from abonnements
   where norm_ref(code_activation) = norm_ref(p_code) for update;
  if not found or v_abo.iepp_id <> v_iepp or v_abo.annee_id <> v_annee then
    raise exception 'Code d''activation invalide pour votre circonscription.';
  end if;
  if v_abo.code_utilise_le is not null or v_abo.statut = 'valide' then
    raise exception 'Ce code a déjà été utilisé. Un code ne sert qu''une seule fois.';
  end if;
  if v_abo.statut <> 'paye' then
    raise exception 'Ce code n''est pas encore actif : le paiement n''est pas confirmé.';
  end if;
  update abonnements set statut = 'valide', code_utilise_le = now() where id = v_abo.id;
  return 'active';
end $$;
grant execute on function utiliser_code_activation(text) to authenticated;

notify pgrst, 'reload schema';
select 'Code d''activation installé' as resultat;
