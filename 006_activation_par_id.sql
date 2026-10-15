-- =====================================================================
--  GESTION IEPP — Activation de l'abonnement par l'ID de transaction
--  • Le superviseur enregistre les ID reçus (SMS Moov / Orange / MTN / Wave).
--  • L'inspecteur saisit l'ID reçu après paiement : si l'ID est connu et
--    pas encore utilisé, le logiciel est activé immédiatement.
--  • Si l'ID n'est pas encore enregistré, la demande reste en attente et
--    s'active toute seule dès que le superviseur enregistre cet ID.
--  • Un ID ne peut servir qu'UNE SEULE FOIS.
--  À lancer APRÈS 005_abonnements.sql. Peut être relancé sans risque.
-- =====================================================================

-- ID normalisé : majuscules, lettres et chiffres seulement (espaces, points, tirets ignorés)
create or replace function norm_ref(t text) returns text
language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- 1. ID de paiement reçus par le gestionnaire
create table if not exists paiements_recus (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null,
  montant         numeric(12,0),
  mode            text not null default 'moov_money'
                  check (mode in ('orange_money', 'mtn_momo', 'moov_money', 'wave', 'especes', 'virement')),
  telephone       text,
  date_reception  date default current_date,
  observations    text,
  utilise_iepp    uuid references iepp(id) on delete set null,
  utilise_annee   uuid references annees_scolaires(id) on delete set null,
  utilise_le      timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists paiements_recus_ref_unique on paiements_recus (norm_ref(reference));

alter table paiements_recus enable row level security;
drop policy if exists paiements_recus_superviseur on paiements_recus;
create policy paiements_recus_superviseur on paiements_recus for all to authenticated
  using (est_superviseur()) with check (est_superviseur());
grant select, insert, update, delete on paiements_recus to authenticated, service_role;

-- 2. Un même ID ne peut figurer que sur un seul abonnement
create unique index if not exists abonnements_ref_unique on abonnements (norm_ref(reference)) where reference is not null;

-- 3. L'inspecteur ne déclare plus directement : tout passe par activer_abonnement()
drop policy if exists abonnements_declaration on abonnements;
drop policy if exists abonnements_redeclaration on abonnements;

-- 4. Activation par l'ID (appelée par l'inspecteur)
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
  if found and v_abo.statut = 'valide' then
    return 'deja_actif';
  end if;
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
            coalesce(v_p.date_reception, current_date), 'valide', now(), auth.uid())
    on conflict (iepp_id, annee_id) do update set
      montant = excluded.montant, mode = excluded.mode, reference = excluded.reference, telephone = excluded.telephone,
      date_paiement = excluded.date_paiement, statut = 'valide', observations = null, valide_le = now();
    return 'active';
  end if;

  -- ID pas encore enregistré par le gestionnaire : demande en attente
  insert into abonnements (iepp_id, annee_id, montant, mode, reference, telephone, statut, declare_par)
  values (v_iepp, v_annee, coalesce(v_tarif, 0), coalesce(p_mode, 'moov_money'), p_reference, p_telephone, 'en_attente', auth.uid())
  on conflict (iepp_id, annee_id) do update set
    mode = excluded.mode, reference = excluded.reference, telephone = excluded.telephone,
    statut = 'en_attente', observations = null, date_paiement = current_date;
  return 'en_attente';
end $$;
grant execute on function activer_abonnement(text, text, text) to authenticated;

-- 5. Quand le superviseur enregistre un ID déjà saisi par une IEPP : activation automatique
create or replace function paiement_recu_apres_ajout() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_abo abonnements%rowtype; v_tarif numeric;
begin
  if new.utilise_le is not null then return new; end if;
  select * into v_abo from abonnements
   where norm_ref(reference) = norm_ref(new.reference) and statut <> 'valide'
   order by created_at desc limit 1;
  if not found then return new; end if;
  select montant into v_tarif from config_abonnement where id = 1;
  if new.montant is not null and v_tarif is not null and new.montant < v_tarif then return new; end if;
  update abonnements set statut = 'valide', valide_le = now(), valide_par = auth.uid(), observations = null,
         montant = coalesce(new.montant, montant), mode = new.mode
   where id = v_abo.id;
  update paiements_recus set utilise_iepp = v_abo.iepp_id, utilise_annee = v_abo.annee_id, utilise_le = now() where id = new.id;
  return new;
end $$;
drop trigger if exists paiement_recu_apres_ajout on paiements_recus;
create trigger paiement_recu_apres_ajout after insert on paiements_recus
  for each row execute function paiement_recu_apres_ajout();

notify pgrst, 'reload schema';
select 'Activation par ID installée' as resultat;
