import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLES, useApp } from './contexte.jsx';
import { supabase } from './supabase';
import { nomComplet } from './Choix.jsx';

/** Nettoie un mot pour un filtre « ilike » (les virgules, parenthèses… casseraient la requête). */
const propre = (m) => m.replace(/[%,()*:\\"']/g, '').trim();
/** Chaque mot tapé doit se retrouver dans l'un des champs (ex. « bamba awa »). */
function filtrerMots(requete, mots, champs, table) {
  let q = requete;
  mots.forEach((m) => {
    const cond = champs.map((c) => `${c}.ilike.%${m}%`).join(',');
    q = table ? q.or(cond, { referencedTable: table }) : q.or(cond);
  });
  return q;
}

/** Bouton « Rechercher » de l'en-tête + fenêtre de recherche générale (raccourci Ctrl+K). */
export default function RechercheGenerale({ menu }) {
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    const touche = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOuvert(true); }
    };
    const ouvrir = () => setOuvert(true);
    window.addEventListener('keydown', touche);
    window.addEventListener('gestion-iepp:recherche', ouvrir);
    return () => { window.removeEventListener('keydown', touche); window.removeEventListener('gestion-iepp:recherche', ouvrir); };
  }, []);
  return (
    <>
      <button className="champ-recherche-entete" onClick={() => setOuvert(true)} title="Rechercher un élève, un agent, une école, un compte (Ctrl+K)">
        <span aria-hidden="true">🔍</span> <span className="texte-recherche">Rechercher…</span>
      </button>
      {ouvert && <FenetreRecherche menu={menu} fermer={() => setOuvert(false)} />}
    </>
  );
}

function FenetreRecherche({ menu, fermer }) {
  const { ieppId, annee, role } = useApp();
  const nav = useNavigate();
  const [texte, setTexte] = useState('');
  const [res, setRes] = useState(null);
  const [charge, setCharge] = useState(false);
  const [actif, setActif] = useState(0);
  const champ = useRef(null);
  const autorise = (chemin) => menu.some((m) => m.chemin === chemin);

  useEffect(() => { champ.current?.focus(); }, []);

  useEffect(() => {
    const mots = texte.split(/\s+/).map(propre).filter((m) => m.length >= 2).slice(0, 4);
    if (!mots.length || !ieppId) { setRes(null); return; }
    let annule = false;
    const minuteur = setTimeout(async () => {
      setCharge(true);
      const demandes = [];
      // Écoles
      if (autorise('/ecoles') || autorise('/annuaire')) {
        demandes.push(filtrerMots(supabase.from('ecoles').select('id, nom, code_ecole, localite').eq('iepp_id', ieppId), mots, ['nom', 'code_ecole', 'localite'])
          .order('nom').limit(8).then(({ data }) => ['ecoles', data || []]));
      }
      // Élèves inscrits cette année
      if (annee && (autorise('/eleves') || autorise('/releves') || autorise('/cartes'))) {
        demandes.push(filtrerMots(supabase.from('inscriptions')
          .select('id, classe_id, eleves!inner(nom, prenoms, matricule, sexe), classes!inner(id, nom, ecole_id, ecoles!inner(nom, iepp_id))')
          .eq('annee_id', annee.id).eq('classes.ecoles.iepp_id', ieppId), mots, ['nom', 'prenoms', 'matricule'], 'eleves')
          .limit(12).then(({ data }) => ['eleves', data || []]));
      }
      // Personnel affecté cette année
      if (annee && autorise('/personnel')) {
        demandes.push(filtrerMots(supabase.from('affectations')
          .select('id, ecole_id, personnel!inner(nom, prenoms, matricule, telephone), fonctions(libelle), ecoles(nom)')
          .eq('iepp_id', ieppId).eq('annee_id', annee.id), mots, ['nom', 'prenoms', 'matricule', 'telephone'], 'personnel')
          .limit(10).then(({ data }) => ['personnel', data || []]));
      }
      // Comptes utilisateurs
      if (autorise('/comptes')) {
        let q = supabase.from('profils').select('id, nom_complet, role, telephone, iepp_id');
        if (role !== 'superviseur') q = q.eq('iepp_id', ieppId);
        demandes.push(filtrerMots(q, mots, ['nom_complet', 'telephone']).limit(8).then(({ data }) => ['comptes', data || []]));
      }
      const tous = Object.fromEntries(await Promise.all(demandes));
      if (annule) return;
      (tous.eleves || []).sort((a, b) => nomComplet(a.eleves).localeCompare(nomComplet(b.eleves), 'fr'));
      (tous.personnel || []).sort((a, b) => nomComplet(a.personnel).localeCompare(nomComplet(b.personnel), 'fr'));
      setRes(tous);
      setActif(0);
      setCharge(false);
    }, 300);
    return () => { annule = true; clearTimeout(minuteur); };
  }, [texte, ieppId, annee]); // eslint-disable-line react-hooks/exhaustive-deps

  // Liste à plat pour le clavier (↑ ↓ Entrée)
  const items = [];
  (res?.ecoles || []).forEach((e) => items.push({
    groupe: 'Écoles', cle: `e${e.id}`, titre: e.nom, detail: [e.code_ecole, e.localite].filter(Boolean).join(' · '),
    aller: () => nav(autorise('/ecoles') ? `/ecoles/${e.id}` : '/annuaire'),
  }));
  (res?.eleves || []).forEach((i) => items.push({
    groupe: 'Élèves', cle: `i${i.id}`, titre: nomComplet(i.eleves),
    detail: `${i.classes?.nom || ''} — ${i.classes?.ecoles?.nom || ''}${i.eleves.matricule ? ` · ${i.eleves.matricule}` : ''}`,
    aller: () => nav(autorise('/eleves') ? '/eleves' : autorise('/releves') ? '/releves' : '/cartes', {
      state: { choix: { ecoleId: i.classes.ecole_id, classeId: i.classe_id }, recherche: i.eleves.nom },
    }),
  }));
  (res?.personnel || []).forEach((a) => items.push({
    groupe: 'Personnel', cle: `p${a.id}`, titre: nomComplet(a.personnel),
    detail: [a.fonctions?.libelle, a.ecoles?.nom || 'Bureau de l’inspection', a.personnel.matricule].filter(Boolean).join(' · '),
    aller: () => nav('/personnel', { state: { recherche: a.personnel.matricule || nomComplet(a.personnel) } }),
  }));
  (res?.comptes || []).forEach((c) => items.push({
    groupe: 'Comptes utilisateurs', cle: `c${c.id}`, titre: c.nom_complet, detail: ROLES[c.role] || c.role,
    aller: () => nav('/comptes', { state: { recherche: c.nom_complet } }),
  }));

  function choisir(it) { fermer(); it.aller(); }
  function clavier(e) {
    if (e.key === 'Escape') fermer();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActif((n) => Math.min(n + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((n) => Math.max(n - 1, 0)); }
    else if (e.key === 'Enter' && items[actif]) { e.preventDefault(); choisir(items[actif]); }
  }

  let groupePrec = null;
  return (
    <div className="recherche-fond" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
      <div className="recherche-fenetre" role="dialog" aria-label="Recherche générale">
        <div className="recherche-saisie">
          <span aria-hidden="true">🔍</span>
          <input ref={champ} value={texte} onChange={(e) => setTexte(e.target.value)} onKeyDown={clavier}
            placeholder="Nom d’un élève, d’un agent, d’une école, matricule, téléphone…" />
          <button className="fermer-barre" aria-label="Fermer" onClick={fermer}>×</button>
        </div>
        <div className="recherche-resultats">
          {!res && !charge && <p className="discret recherche-aide">Tapez au moins 2 lettres. Exemples : « Bamba Awa », un matricule, « EPP Liberté », un numéro de téléphone.<br />Raccourci : <b>Ctrl + K</b> depuis n’importe quelle page · ↑ ↓ puis Entrée pour ouvrir.</p>}
          {charge && <p className="discret recherche-aide">Recherche…</p>}
          {res && !charge && !items.length && <p className="discret recherche-aide">Aucun résultat pour « {texte} » dans {annee ? `l’année ${annee.libelle}` : 'la circonscription'}.</p>}
          {items.map((it, k) => {
            const titre = it.groupe !== groupePrec ? it.groupe : null;
            groupePrec = it.groupe;
            return (
              <div key={it.cle}>
                {titre && <div className="recherche-groupe">{titre}</div>}
                <button className={`recherche-item ${k === actif ? 'actif' : ''}`} onMouseEnter={() => setActif(k)} onClick={() => choisir(it)}>
                  <b>{it.titre}</b><span>{it.detail}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
