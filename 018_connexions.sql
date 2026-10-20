-- =====================================================================
--  GESTION IEPP — Voir qui est connecté
--  Pendant qu'un utilisateur a le logiciel ouvert, son activité est notée
--  toutes les 2 minutes. Le superviseur voit toutes les circonscriptions ;
--  l'inspecteur voit les utilisateurs de sa circonscription.
--  À coller dans Supabase > SQL Editor > New query, puis Run.
-- =====================================================================

alter table profils add column if not exists derniere_activite timestamptz;

-- Appelé par le logiciel ouvert (toutes les 2 minutes)
create or replace function signaler_presence()
returns void language sql security definer set search_path = public as $$
  update profils set derniere_activite = now() where id = auth.uid();
$$;
grant execute on function signaler_presence() to authenticated;

-- Liste des utilisateurs avec leur dernière activité et leur dernière connexion
create or replace function presences()
returns table (
  id uuid, nom_complet text, role text, actif boolean,
  iepp_id uuid, iepp text, drena text, ecole text,
  derniere_activite timestamptz, derniere_connexion timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.nom_complet, p.role::text, p.actif,
         p.iepp_id, i.nom, d.nom, e.nom,
         p.derniere_activite, u.last_sign_in_at
    from profils p
    left join auth.users u on u.id = p.id
    left join iepp i on i.id = p.iepp_id
    left join drena d on d.id = i.drena_id
    left join ecoles e on e.id = p.ecole_id
   where est_superviseur()
      or (mon_role()::text = 'iepp' and p.iepp_id = mon_iepp())
   order by p.derniere_activite desc nulls last, u.last_sign_in_at desc nulls last
$$;
grant execute on function presences() to authenticated;

notify pgrst, 'reload schema';
select 'Suivi des connexions installé' as resultat;
