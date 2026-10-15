import { useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase } from './supabase';
import Crud from './Crud.jsx';
import { nomComplet } from './Choix.jsx';

/** Personnel affecté à la circonscription pour l'année active. */
export function usePersonnelIepp() {
  const { ieppId, annee } = useApp();
  const [liste, setListe] = useState([]);
  useEffect(() => {
    if (!ieppId || !annee) return;
    supabase.from('affectations')
      .select('ecole_id, fonction_code, personnel(id, nom, prenoms, emploi_code, matricule)')
      .eq('iepp_id', ieppId).eq('annee_id', annee.id)
      .then(({ data }) => setListe((data || []).filter((a) => a.personnel).map((a) => ({ ...a.personnel, ecole_id: a.ecole_id, fonction_code: a.fonction_code }))
        .sort((a, b) => nomComplet(a).localeCompare(nomComplet(b)))));
  }, [ieppId, annee]);
  return liste;
}

export default function Secteurs() {
  const { ieppId, peutGerer } = useApp();
  const personnel = usePersonnelIepp();
  const [nbEcoles, setNbEcoles] = useState({});

  useEffect(() => {
    if (!ieppId) return;
    supabase.from('ecoles').select('secteur_id').eq('iepp_id', ieppId).then(({ data }) => {
      const c = {};
      (data || []).forEach((e) => { if (e.secteur_id) c[e.secteur_id] = (c[e.secteur_id] || 0) + 1; });
      setNbEcoles(c);
    });
  }, [ieppId]);

  const conseillers = personnel.filter((p) => p.emploi_code === 'CP' || p.fonction_code === 'CP_SECT');
  const options = (conseillers.length ? conseillers : personnel).map((p) => ({ value: p.id, label: `${nomComplet(p)}${p.matricule ? ` (${p.matricule})` : ''}` }));

  return (
    <Crud titre="Secteurs pédagogiques" table="secteurs" filtre={{ iepp_id: ieppId }} lectureSeule={!peutGerer}
      select="*, conseiller:personnel(nom, prenoms, telephone)"
      choixListe={{ tous: 'Tous les secteurs pédagogiques', libelle: (l) => l.nom }}
      champs={[
        { nom: 'nom', label: 'Nom du secteur', requis: true },
        { nom: 'conseiller_id', label: 'Conseiller pédagogique', type: 'select', options, aide: 'Le conseiller doit être enregistré dans Personnel.' },
      ]}
      colonnes={[
        { cle: 'nom', label: 'Secteur' },
        { cle: 'conseiller', label: 'Conseiller pédagogique', rendu: (l) => nomComplet(l.conseiller) || <span className="discret">Non désigné</span> },
        { cle: 'tel', label: 'Contact', rendu: (l) => l.conseiller?.telephone },
        { cle: 'nb', label: 'Écoles', rendu: (l) => nbEcoles[l.id] || 0 },
      ]}
    />
  );
}
