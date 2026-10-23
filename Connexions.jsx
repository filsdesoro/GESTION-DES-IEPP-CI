import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';

const EN_LIGNE_MIN = 5; // connecté = activité dans les 5 dernières minutes

/** Signale toutes les 2 minutes que l'utilisateur a le logiciel ouvert. */
export function usePresence(actif) {
  useEffect(() => {
    if (!actif) return;
    let arret = false;
    const signaler = () => { if (!arret && document.visibilityState === 'visible') supabase.rpc('signaler_presence').then(() => {}, () => {}); };
    signaler();
    const t = setInterval(signaler, 120000);
    document.addEventListener('visibilitychange', signaler);
    return () => { arret = true; clearInterval(t); document.removeEventListener('visibilitychange', signaler); };
  }, [actif]);
}

const minutesDepuis = (d) => (d ? (Date.now() - new Date(d).getTime()) / 60000 : Infinity);
const enLigne = (u) => minutesDepuis(u.derniere_activite) <= EN_LIGNE_MIN;

/** Pastille « 🟢 N connectés » de l'en-tête, avec la liste des comptes en ligne. */
export function PastilleConnectes() {
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    let arret = false;
    const lire = () => supabase.rpc('presences').then(({ data, error }) => {
      if (!arret && !error) setListe((data || []).filter((u) => u.role !== 'superviseur' && enLigne(u)));
    });
    lire();
    const t = setInterval(lire, 60000);
    return () => { arret = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e) => { if (!e.target.closest('.pastille-connectes-zone')) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, [ouvert]);
  if (liste === null) return null;
  return (
    <div className="pastille-connectes-zone">
      <button className={`pastille-connectes ${liste.length ? 'on' : ''}`} onClick={() => setOuvert(!ouvert)} title="Utilisateurs connectés en ce moment">
        <span className={`point-etat ${liste.length ? 'on' : ''}`} /> <b>{liste.length}</b> <span className="texte-connectes">connecté{liste.length > 1 ? 's' : ''}</span>
      </button>
      {ouvert && (
        <div className="menu-connectes">
          <div className="mc-titre">{liste.length ? `${liste.length} compte${liste.length > 1 ? 's' : ''} en ligne` : 'Personne en ligne en ce moment'}</div>
          <div className="mc-liste">
            {liste.map((u) => (
              <div key={u.id} className="mc-ligne">
                <span className="point-etat on" />
                <span><b>{u.nom_complet}</b><span className="discret"> — {ROLES[u.role] || u.role}{u.iepp ? ` · ${u.iepp}` : ''}{u.ecole ? ` · ${u.ecole}` : ''}</span></span>
              </div>
            ))}
          </div>
          <button className="btn-contour petit" onClick={() => { setOuvert(false); nav('/connexions'); }}>Voir toutes les connexions →</button>
        </div>
      )}
    </div>
  );
}
const aujourdhui = (d) => d && new Date(d).toDateString() === new Date().toDateString();

function ilYa(d) {
  if (!d) return 'Jamais';
  const m = minutesDepuis(d);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${Math.round(m)} min`;
  if (aujourdhui(d)) return `aujourd’hui à ${new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const j = Math.floor(m / 1440);
  if (j < 1) return `hier à ${new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return `${new Date(d).toLocaleDateString('fr-FR')} (il y a ${j} j)`;
}

/** Page « Connexions » : qui utilise le logiciel en ce moment, par circonscription. */
export default function Connexions() {
  const { role } = useApp();
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState('');
  const [filtre, setFiltre] = useState('tous');
  const [texte, setTexte] = useState('');
  const [maj, setMaj] = useState(null);

  async function charger() {
    const { data, error } = await supabase.rpc('presences');
    if (error) {
      setErreur(/function|schema cache/i.test(error.message) ? 'Lancez d’abord le script 018_connexions.sql dans Supabase (SQL Editor).' : traduireErreur(error));
      setListe([]);
      return;
    }
    setErreur('');
    setListe((data || []).filter((u) => u.role !== 'superviseur'));
    setMaj(new Date());
  }
  useEffect(() => {
    charger();
    const t = setInterval(charger, 60000); // mise à jour automatique chaque minute
    return () => clearInterval(t);
  }, []);

  // Une carte par circonscription
  const parIepp = useMemo(() => {
    const g = {};
    (liste || []).filter((u) => u.iepp_id).forEach((u) => {
      const k = u.iepp_id;
      const x = g[k] || (g[k] = { id: k, nom: u.iepp || '—', drena: u.drena || '', comptes: 0, enLigne: [], inspecteur: null, derniere: null });
      x.comptes += 1;
      if (enLigne(u)) x.enLigne.push(u);
      if (u.role === 'iepp') x.inspecteur = u;
      if (u.derniere_activite && (!x.derniere || u.derniere_activite > x.derniere)) x.derniere = u.derniere_activite;
    });
    return Object.values(g).sort((a, b) => b.enLigne.length - a.enLigne.length || (b.derniere || '').localeCompare(a.derniere || '') || a.nom.localeCompare(b.nom, 'fr'));
  }, [liste]);

  const t = texte.trim().toLowerCase();
  const lignes = (liste || []).filter((u) => (filtre === 'tous' || (filtre === 'enligne' ? enLigne(u) : aujourdhui(u.derniere_activite) || aujourdhui(u.derniere_connexion)))
    && (!t || `${u.nom_complet} ${u.iepp || ''} ${u.drena || ''} ${u.ecole || ''} ${ROLES[u.role] || ''}`.toLowerCase().includes(t)));
  const nbEnLigne = (liste || []).filter(enLigne).length;
  const nbAujourdhui = (liste || []).filter((u) => aujourdhui(u.derniere_activite) || aujourdhui(u.derniere_connexion)).length;

  return (
    <div>
      <h1>Connexions</h1>
      <p className="aide">
        {role === 'superviseur' ? 'Utilisateurs de toutes les circonscriptions. ' : 'Utilisateurs de votre circonscription. '}
        « En ligne » = logiciel ouvert dans les {EN_LIGNE_MIN} dernières minutes. Mise à jour automatique chaque minute
        {maj && <> (dernière : {maj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})</>}.
      </p>
      {erreur && <div className="alerte">{erreur}</div>}

      <div className="cartes-connexions">
        <div className="carte stat-connexion"><b className="vert-texte">{nbEnLigne}</b><span>en ligne maintenant</span></div>
        <div className="carte stat-connexion"><b>{nbAujourdhui}</b><span>connecté(s) aujourd’hui</span></div>
        <div className="carte stat-connexion"><b>{(liste || []).length}</b><span>comptes au total</span></div>
        {role === 'superviseur' && <div className="carte stat-connexion"><b>{parIepp.filter((g) => g.enLigne.length).length}</b><span>IEPP en ligne sur {parIepp.length}</span></div>}
      </div>

      {role === 'superviseur' && parIepp.length > 0 && (
        <>
          <h2>Par circonscription</h2>
          <div className="grille-iepp-connexions">
            {parIepp.map((g) => (
              <div key={g.id} className={`carte iepp-connexion ${g.enLigne.length ? 'allumee' : ''}`}>
                <div className="iepp-connexion-tete">
                  <span className={`point-etat ${g.enLigne.length ? 'on' : ''}`} />
                  <b>{g.nom}</b>
                </div>
                {g.drena && <div className="discret">{g.drena}</div>}
                <div>{g.enLigne.length ? <b className="vert-texte">{g.enLigne.length} en ligne</b> : <span className="discret">Personne en ligne</span>} · {g.comptes} compte(s)</div>
                <div className="discret">Inspecteur : {g.inspecteur ? `${g.inspecteur.nom_complet} — ${enLigne(g.inspecteur) ? 'en ligne' : ilYa(g.inspecteur.derniere_activite || g.inspecteur.derniere_connexion)}` : 'aucun compte'}</div>
                <div className="discret">Dernière activité : {ilYa(g.derniere)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Utilisateurs</h2>
      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher (nom, IEPP, école, rôle)…" value={texte} onChange={(e) => setTexte(e.target.value)} />
        <div className="bascule">
          {[['tous', 'Tous'], ['enligne', `En ligne (${nbEnLigne})`], ['jour', 'Aujourd’hui']].map(([k, l]) => (
            <button key={k} className={filtre === k ? 'actif' : ''} onClick={() => setFiltre(k)}>{l}</button>
          ))}
        </div>
        <div className="espace" />
        <button className="btn-contour" onClick={charger}>⟳ Actualiser</button>
      </div>
      {liste === null ? <p>Chargement…</p> : (
        <div className="tableau-cadre">
          <table className="tableau">
            <thead><tr><th>État</th><th>Nom</th><th>Rôle</th>{role === 'superviseur' && <th>Circonscription</th>}<th>École</th><th>Dernière activité</th><th>Dernière connexion</th></tr></thead>
            <tbody>
              {lignes.length === 0 && <tr><td colSpan={7} className="vide">Aucun utilisateur pour ce choix.</td></tr>}
              {lignes.map((u) => (
                <tr key={u.id}>
                  <td>{enLigne(u) ? <span className="badge vert">● En ligne</span> : !u.actif ? <span className="badge rouge">Bloqué</span> : <span className="badge">Hors ligne</span>}</td>
                  <td><b>{u.nom_complet}</b></td>
                  <td>{ROLES[u.role] || u.role}</td>
                  {role === 'superviseur' && <td>{u.iepp || '—'}</td>}
                  <td>{u.ecole || '—'}</td>
                  <td>{ilYa(u.derniere_activite)}</td>
                  <td>{ilYa(u.derniere_connexion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
