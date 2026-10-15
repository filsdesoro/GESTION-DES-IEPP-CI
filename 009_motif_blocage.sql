-- =====================================================================
--  GESTION IEPP — Motif affiché à un utilisateur bloqué (ex. non-paiement)
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================
alter table profils add column if not exists motif_blocage text;
notify pgrst, 'reload schema';
select 'Motif de blocage installé' as resultat;
