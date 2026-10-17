import { useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase } from './supabase';

/** Charge une liste simple (référentiels, listes déroulantes). */
export function useListe(table, { select = '*', filtre = {}, ordre, actif = true } = {}) {
  const [liste, setListe] = useState([]);
  const cle = JSON.stringify(filtre);
  useEffect(() => {
    if (!actif) return;
    const f = JSON.parse(cle);
    if (Object.values(f).some((v) => v === null || v === undefined)) { setListe([]); return; }
    let q = supabase.from(table).select(select);
    Object.entries(f).forEach(([k, v]) => { q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v); });
    if (ordre) q = q.order(ordre);
    q.then(({ data }) => setListe(data || []));
  }, [table, select, cle, ordre, actif]);
  return liste;
}

/** Écoles visibles de la circonscription courante. */
export function useEcoles() {
  const { ieppId, profil } = useApp();
  const filtre = { iepp_id: ieppId };
  if (['directeur', 'saisie', 'enseignant'].includes(profil?.role)) filtre.id = profil.ecole_id;
  if (profil?.role === 'conseiller') filtre.secteur_id = profil.secteur_id;
  return useListe('ecoles', { select: 'id, nom, code_ecole, secteur_id, statut, cycle, localite', filtre, ordre: 'nom' });
}

/**
 * Sélecteurs École → Classe (année active).
 * valeur = { ecoleId, classeId }, changer(nouvelleValeur, classeObjet)
 */
export function ChoixEcoleClasse({ valeur, changer, niveaux, sansClasse }) {
  const { annee } = useApp();
  const ecoles = useEcoles();
  const classes = useListe('classes', {
    select: 'id, nom, niveau_code, ecole_id, maitre_id',
    filtre: { ecole_id: valeur.ecoleId || null, annee_id: annee?.id || null },
    ordre: 'nom',
  });
  const classesFiltrees = niveaux ? classes.filter((c) => niveaux.includes(c.niveau_code)) : classes;

  // Sélection automatique s'il n'y a qu'une école
  useEffect(() => {
    if (!valeur.ecoleId && ecoles.length === 1) changer({ ecoleId: ecoles[0].id, classeId: null }, null);
  }, [ecoles]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="choix-ligne">
      <label>École
        <select value={valeur.ecoleId || ''} onChange={(e) => changer({ ecoleId: e.target.value || null, classeId: null }, null)}>
          <option value="">— choisir une école —</option>
          {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
      </label>
      {!sansClasse && (
        <label>Classe
          <select value={valeur.classeId || ''} disabled={!valeur.ecoleId}
            onChange={(e) => changer({ ...valeur, classeId: e.target.value || null }, classesFiltrees.find((c) => c.id === e.target.value) || null)}>
            <option value="">— choisir une classe —</option>
            {classesFiltrees.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export const nomComplet = (p) => (p ? `${p.nom || ''} ${p.prenoms || ''}`.trim() : '');
export const dateFr = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-FR') : '');
export const fmt = (n, d = 2) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** Personnel de la circonscription pour l'année active : fiches par id et directeur de chaque école. */
export function useEquipes() {
  const { ieppId, annee } = useApp();
  const [eq, setEq] = useState({ parId: {}, directeurs: {} });
  useEffect(() => {
    if (!ieppId || !annee) return;
    supabase.from('affectations').select('ecole_id, fonction_code, personnel(id, nom, prenoms, telephone)')
      .eq('iepp_id', ieppId).eq('annee_id', annee.id)
      .then(({ data }) => {
        const parId = {};
        const directeurs = {};
        (data || []).forEach((a) => {
          if (!a.personnel) return;
          parId[a.personnel.id] = a.personnel;
          if (a.ecole_id && ['DIR_DECH', 'DIR_CLASSE'].includes(a.fonction_code) && !directeurs[a.ecole_id]) directeurs[a.ecole_id] = a.personnel;
        });
        setEq({ parId, directeurs });
      });
  }, [ieppId, annee]);
  return eq;
}
