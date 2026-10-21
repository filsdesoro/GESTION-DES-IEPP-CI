import { useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';

/** Prévient la barre « Annuler » qu'une suppression vient d'avoir lieu. */
export function signalerSuppression(libelle) {
  window.dispatchEvent(new CustomEvent('gestion-iepp:suppression', { detail: { libelle } }));
}

const NOMS = {
  eleves: 'Élève', inscriptions: 'Élève', notes: 'Notes', personnel: 'Personnel', affectations: 'Personnel',
  ecoles: 'École', classes: 'Classe', secteurs: 'Secteur', compositions: 'Composition', matieres: 'Matière',
  abonnements: 'Abonnement', paiements_recus: 'ID de paiement', annees_scolaires: 'Année scolaire',
  drena: 'DRENA', iepp: 'Circonscription', cepe_centres: 'Centre CEPE', fiches_eps: 'Fiche EPS', emplois: 'Emploi',
  cepe_candidats: 'Candidat CEPE', forum_sujets: 'Sujet du forum', forum_reponses: 'Réponse du forum', profils: 'Compte utilisateur', 'auth.users': 'Compte utilisateur',
};

function messageErreur(e) {
  const m = traduireErreur(e);
  return /function|schema cache/i.test(m) ? 'La corbeille n’est pas encore installée : lancez le script 016_corbeille.sql dans Supabase.' : m;
}

/** Supprime un élève (son inscription, ses notes ; la fiche élève si plus aucune inscription). */
export async function supprimerEleve(inscriptionId) {
  let { error } = await supabase.rpc('supprimer_eleve', { p_inscription: inscriptionId });
  if (error && /function|schema cache/i.test(error.message)) ({ error } = await supabase.from('inscriptions').delete().eq('id', inscriptionId));
  return error ? traduireErreur(error) : null;
}

/** Supprime les notes d'une composition (un élève, ou toute la classe si inscriptionId est vide). */
export async function supprimerNotes(compositionId, classeId, inscriptionId = null) {
  const { error } = await supabase.rpc('supprimer_notes', { p_composition: compositionId, p_classe: classeId, p_inscription: inscriptionId });
  if (!error) return null;
  return /function|schema cache/i.test(error.message) ? 'Lancez d’abord le script 017_suppressions_pages.sql dans Supabase.' : traduireErreur(error);
}

/** Barre affichée quelques secondes après une suppression, avec le bouton « Annuler ». */
export function BarreAnnuler() {
  const { actualiser } = useApp();
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let minuteur;
    const ecoute = (e) => {
      setMsg('');
      setInfo(e.detail);
      clearTimeout(minuteur);
      minuteur = setTimeout(() => setInfo(null), 12000);
    };
    window.addEventListener('gestion-iepp:suppression', ecoute);
    return () => { window.removeEventListener('gestion-iepp:suppression', ecoute); clearTimeout(minuteur); };
  }, []);
  if (!info) return null;

  async function annuler() {
    setMsg('Restauration…');
    const { error } = await supabase.rpc('annuler_derniere_suppression');
    if (error) return setMsg(messageErreur(error));
    setMsg('✓ Suppression annulée');
    await actualiser();
    setTimeout(() => setInfo(null), 2500);
  }
  return (
    <div className="barre-annuler" role="status">
      <span>{msg || <>🗑 {info.libelle ? <b>{info.libelle}</b> : 'Élément'} supprimé.</>}</span>
      {!msg && <button className="btn" onClick={annuler}>↶ Annuler</button>}
      <button className="fermer-barre" aria-label="Fermer" onClick={() => setInfo(null)}>×</button>
    </div>
  );
}

/** Page Corbeille : tout ce qui a été supprimé ces 60 derniers jours, avec « Restaurer ». */
export default function Corbeille() {
  const { role, actualiser } = useApp();
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState('');
  const [filtre, setFiltre] = useState('');
  const [enCours, setEnCours] = useState(null);

  async function charger() {
    const { data, error } = await supabase.rpc('corbeille_liste');
    if (error) { setErreur(messageErreur(error)); setListe([]); } else { setErreur(''); setListe(data || []); }
  }
  useEffect(() => { charger(); }, []);

  async function restaurer(g) {
    setEnCours(g.groupe);
    const { error } = await supabase.rpc('restaurer', { p_groupe: g.groupe });
    setEnCours(null);
    if (error) return alert(messageErreur(error));
    await actualiser();
  }
  async function effacer(g) {
    if (!confirm(g ? `Effacer définitivement « ${g.libelle || NOMS[g.table_nom]} » ? Il ne pourra plus être restauré.` : 'Vider toute la corbeille ? Rien ne pourra plus être restauré.')) return;
    const { error } = await supabase.rpc('vider_corbeille', { p_groupe: g ? g.groupe : null });
    if (error) return alert(messageErreur(error));
    charger();
  }

  const q = filtre.trim().toLowerCase();
  const vues = (liste || []).filter((g) => !q || `${g.libelle || ''} ${NOMS[g.table_nom] || ''} ${g.supprime_par}`.toLowerCase().includes(q));

  return (
    <div>
      <h1>Corbeille</h1>
      <p className="aide">Les éléments supprimés restent ici <b>60 jours</b>. « Restaurer » les remet en place avec tout ce qui avait été supprimé avec eux (inscription, notes, classes…).
        {role !== 'superviseur' && ' Vous voyez uniquement vos propres suppressions.'}</p>
      {erreur && <div className="alerte">{erreur}</div>}
      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher…" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
        <div className="espace" />
        {role === 'superviseur' && liste?.length > 0 && <button className="btn-contour danger" onClick={() => effacer(null)}>Vider la corbeille</button>}
      </div>
      {liste === null ? <p>Chargement…</p> : vues.length === 0 ? <p className="vide">La corbeille est vide.</p> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Supprimé le</th><th>Type</th><th>Élément</th><th>Éléments liés</th><th>Par</th><th></th></tr></thead>
            <tbody>
              {vues.map((g) => (
                <tr key={g.groupe}>
                  <td>{new Date(g.supprime_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{NOMS[g.table_nom] || g.table_nom}</td>
                  <td><b>{g.libelle || '—'}</b></td>
                  <td>{g.nb > 1 ? `${g.nb - 1} élément(s)` : '—'}</td>
                  <td>{g.supprime_par}</td>
                  <td className="actions-ligne">
                    <button className="btn" disabled={enCours === g.groupe} onClick={() => restaurer(g)}>{enCours === g.groupe ? '…' : '↶ Restaurer'}</button>
                    {role === 'superviseur' && <button className="btn-contour danger" onClick={() => effacer(g)}>Effacer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
