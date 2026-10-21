import { useCallback, useEffect, useState } from 'react';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { signalerSuppression } from './Corbeille.jsx';
import { ChoixModele } from './Modeles.jsx';

const CATEGORIES = ['Annonces', 'Pédagogie', 'Administration', 'Examens et CEPE', 'Statistiques et rapports', 'Questions sur le logiciel', 'Divers'];
const MANQUE_SCRIPT = 'Le forum n’est pas encore installé : lancez le script 022_forum.sql dans Supabase (SQL Editor).';
const erreurLisible = (e) => (/function|schema cache|relation .* does not exist/i.test(e?.message || '') ? MANQUE_SCRIPT : traduireErreur(e));

/** Nombre de sujets avec du nouveau (pour le menu). */
export function useNouveautesForum(actif) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!actif) return;
    let arret = false;
    const lire = () => supabase.rpc('forum_nouveautes').then(({ data, error }) => { if (!arret && !error) setN(data || 0); });
    lire();
    const t = setInterval(lire, 90000);
    window.addEventListener('gestion-iepp:forum', lire);
    return () => { arret = true; clearInterval(t); window.removeEventListener('gestion-iepp:forum', lire); };
  }, [actif]);
  return n;
}
const prevenirMenu = () => window.dispatchEvent(new Event('gestion-iepp:forum'));

function quand(d) {
  const x = new Date(d);
  const min = (Date.now() - x.getTime()) / 60000;
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${Math.round(min)} min`;
  if (x.toDateString() === new Date().toDateString()) return `aujourd’hui à ${x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return x.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const signature = (x) => `${x.auteur_nom || 'Compte supprimé'}${x.auteur_role ? ` · ${ROLES[x.auteur_role] || x.auteur_role}` : ''}${x.auteur_iepp ? ` · ${x.auteur_iepp}` : ''}`;

export default function Forum() {
  const { role, iepp, ieppId } = useApp();
  const espaces = [];
  if (role === 'superviseur' || role === 'iepp') espaces.push(['inter', '🌍 Forum inter-IEPP']);
  if (ieppId) espaces.push(['circ', `🏫 Forum de la circonscription${iepp ? ` — ${iepp.nom}` : ''}`]);
  const [espace, setEspace] = useState(espaces[0]?.[0] || 'circ');
  const [sujetId, setSujetId] = useState(null);
  const [nouveau, setNouveau] = useState(false);

  return (
    <div className="forum">
      <div className="titre-ligne">
        <h1>Forum</h1>
        {!sujetId && !nouveau && <button className="btn" onClick={() => setNouveau(true)}>+ Nouveau sujet</button>}
      </div>
      {espaces.length > 1 && (
        <div className="onglets">
          {espaces.map(([k, l]) => <button key={k} className={espace === k ? 'actif' : ''} onClick={() => { setEspace(k); setSujetId(null); setNouveau(false); }}>{l}</button>)}
        </div>
      )}
      <p className="aide">{espace === 'inter'
        ? 'Espace d’échange entre les inspecteurs de toutes les circonscriptions et le superviseur.'
        : 'Espace d’échange de toute la circonscription : inspecteur, conseillers pédagogiques, directeurs, agents de saisie et enseignants.'}</p>
      {nouveau
        ? <NouveauSujet espace={espace} ieppId={ieppId} annuler={() => setNouveau(false)} cree={(id) => { setNouveau(false); setSujetId(id); }} />
        : sujetId
          ? <Sujet id={sujetId} retour={() => setSujetId(null)} />
          : <ListeSujets espace={espace} ieppId={ieppId} ouvrir={setSujetId} />}
    </div>
  );
}

function ListeSujets({ espace, ieppId, ouvrir }) {
  const { profil } = useApp();
  const [sujets, setSujets] = useState(null);
  const [vues, setVues] = useState({});
  const [categorie, setCategorie] = useState('');
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    let q = supabase.from('forum_sujets').select('id, categorie, titre, contenu, auteur_id, auteur_nom, auteur_role, auteur_iepp, epingle, verrouille, nb_reponses, derniere_activite, created_at').eq('espace', espace);
    q = espace === 'circ' ? q.eq('iepp_id', ieppId) : q.is('iepp_id', null);
    const [s, v] = await Promise.all([q.order('derniere_activite', { ascending: false }).limit(300), supabase.from('forum_vues').select('sujet_id, vu_le').eq('user_id', profil.id)]);
    if (s.error) { setErreur(erreurLisible(s.error)); setSujets([]); return; }
    setErreur('');
    setSujets((s.data || []).sort((a, b) => b.epingle - a.epingle));
    setVues(Object.fromEntries((v.data || []).map((x) => [x.sujet_id, x.vu_le])));
  }, [espace, ieppId, profil.id]);
  useEffect(() => { charger(); const t = setInterval(charger, 90000); return () => clearInterval(t); }, [charger]);

  const t = texte.trim().toLowerCase();
  const liste = (sujets || []).filter((s) => (!categorie || s.categorie === categorie) && (!t || `${s.titre} ${s.contenu} ${s.auteur_nom} ${s.auteur_iepp || ''}`.toLowerCase().includes(t)));
  const nouveau = (s) => s.auteur_id !== profil.id && (!vues[s.id] || s.derniere_activite > vues[s.id]);

  return (
    <>
      {erreur && <div className="alerte">{erreur}</div>}
      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher un sujet…" value={texte} onChange={(e) => setTexte(e.target.value)} />
        <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className="espace" />
        <button className="btn-contour" onClick={charger}>⟳ Actualiser</button>
      </div>
      {sujets === null ? <p>Chargement…</p> : (
        <div className="carte liste-sujets">
          {liste.length === 0 && <p className="vide">{sujets.length ? 'Aucun sujet pour ce choix.' : 'Aucun sujet pour l’instant. Lancez la discussion avec « + Nouveau sujet ».'}</p>}
          {liste.map((s) => (
            <button key={s.id} className={`ligne-sujet ${nouveau(s) ? 'nouveau' : ''}`} onClick={() => ouvrir(s.id)}>
              <span className="ls-titre">
                {s.epingle && <span title="Épinglé">📌 </span>}{s.verrouille && <span title="Fermé">🔒 </span>}
                <b>{s.titre}</b>{nouveau(s) && <span className="badge vert">nouveau</span>}
                <span className="discret ls-auteur">{signature(s)}</span>
              </span>
              <span className="badge">{s.categorie}</span>
              <span className="ls-chiffres"><b>{s.nb_reponses}</b> réponse{s.nb_reponses > 1 ? 's' : ''}<span className="discret">{quand(s.derniere_activite)}</span></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function NouveauSujet({ espace, ieppId, annuler, cree }) {
  const [v, setV] = useState({ categorie: espace === 'inter' ? 'Pédagogie' : 'Annonces', titre: '', contenu: '' });
  const [msg, setMsg] = useState('');
  const [envoi, setEnvoi] = useState(false);
  async function publier(e) {
    e.preventDefault();
    setEnvoi(true);
    const { data, error } = await supabase.rpc('forum_creer_sujet', { p_espace: espace, p_iepp: ieppId || null, p_categorie: v.categorie, p_titre: v.titre, p_contenu: v.contenu });
    setEnvoi(false);
    if (error) return setMsg(erreurLisible(error));
    cree(data);
  }
  return (
    <form className="carte redaction" onSubmit={publier}>
      <h2>Nouveau sujet — {espace === 'inter' ? 'Forum inter-IEPP' : 'Forum de la circonscription'}</h2>
      <label>Catégorie
        <select value={v.categorie} onChange={(e) => setV({ ...v, categorie: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <ChoixModele objet={v.titre} corps={v.contenu} libelleObjet="Titre" appliquer={(m) => setV({ ...v, titre: m.objet, contenu: m.corps })} />
      <label>Titre<input value={v.titre} maxLength={160} required onChange={(e) => setV({ ...v, titre: e.target.value })} placeholder="ex. Organisation du CEPE blanc" /></label>
      <label>Message<textarea rows={8} required value={v.contenu} onChange={(e) => setV({ ...v, contenu: e.target.value })} /></label>
      {msg && <p className="erreur">{msg}</p>}
      <div className="actions">
        <button type="button" className="btn-contour" onClick={annuler}>Annuler</button>
        <button className="btn" disabled={envoi}>{envoi ? 'Publication…' : 'Publier'}</button>
      </div>
    </form>
  );
}

function Sujet({ id, retour }) {
  const { profil, role } = useApp();
  const [s, setS] = useState(null);
  const [reponses, setReponses] = useState([]);
  const [texte, setTexte] = useState('');
  const [msg, setMsg] = useState('');
  const [edition, setEdition] = useState(null);

  const charger = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('forum_sujets').select('*').eq('id', id).maybeSingle(),
      supabase.from('forum_reponses').select('*').eq('sujet_id', id).order('created_at'),
    ]);
    if (a.error) return setMsg(erreurLisible(a.error));
    if (!a.data) { retour(); return; }
    setS(a.data);
    setReponses(b.data || []);
    await supabase.from('forum_vues').upsert({ user_id: profil.id, sujet_id: id, vu_le: new Date().toISOString() });
    prevenirMenu();
  }, [id, profil.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); const t = setInterval(charger, 60000); return () => clearInterval(t); }, [charger]);

  if (!s) return <p>{msg || 'Chargement…'}</p>;
  const moderateur = role === 'superviseur' || (role === 'iepp' && s.espace === 'circ' && s.iepp_id === profil.iepp_id);
  const peutModifier = (x) => x.auteur_id === profil.id || moderateur;

  async function repondre(e) {
    e.preventDefault();
    setMsg('');
    const { error } = await supabase.rpc('forum_repondre', { p_sujet: id, p_contenu: texte });
    if (error) return setMsg(erreurLisible(error));
    setTexte('');
    charger();
  }
  async function basculer(champ) {
    const { error } = await supabase.from('forum_sujets').update({ [champ]: !s[champ] }).eq('id', id);
    if (error) return setMsg(erreurLisible(error));
    charger();
  }
  async function supprimerSujet() {
    if (!confirm(`Supprimer le sujet « ${s.titre} » et ses ${s.nb_reponses} réponse(s) ?\n(Vous pourrez annuler, ou le restaurer depuis la Corbeille.)`)) return;
    const { error } = await supabase.from('forum_sujets').delete().eq('id', id);
    if (error) return setMsg(erreurLisible(error));
    signalerSuppression(`Sujet « ${s.titre} »`);
    retour();
  }
  async function supprimerReponse(r) {
    if (!confirm('Supprimer cette réponse ?\n(Vous pourrez annuler, ou la restaurer depuis la Corbeille.)')) return;
    const { error } = await supabase.from('forum_reponses').delete().eq('id', r.id);
    if (error) return setMsg(erreurLisible(error));
    signalerSuppression('Réponse du forum');
    charger();
  }
  async function enregistrerEdition(e) {
    e.preventDefault();
    const table = edition.type === 'sujet' ? 'forum_sujets' : 'forum_reponses';
    const champs = edition.type === 'sujet' ? { titre: edition.titre, contenu: edition.contenu, categorie: edition.categorie } : { contenu: edition.contenu };
    const { error } = await supabase.from(table).update({ ...champs, modifie_le: new Date().toISOString() }).eq('id', edition.id);
    if (error) return setMsg(erreurLisible(error));
    setEdition(null);
    charger();
  }

  const message = (x, type) => (
    edition?.id === x.id ? (
      <form className="message-forum edition" onSubmit={enregistrerEdition}>
        {type === 'sujet' && <input value={edition.titre} onChange={(e) => setEdition({ ...edition, titre: e.target.value })} required />}
        {type === 'sujet' && <select value={edition.categorie} onChange={(e) => setEdition({ ...edition, categorie: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}
        <textarea rows={6} value={edition.contenu} onChange={(e) => setEdition({ ...edition, contenu: e.target.value })} required />
        <div className="actions"><button type="button" className="btn-contour" onClick={() => setEdition(null)}>Annuler</button><button className="btn">Enregistrer</button></div>
      </form>
    ) : (
      <div className={`message-forum ${type === 'sujet' ? 'principal' : ''}`}>
        <div className="mf-entete">
          <span className="avatar petit">{(x.auteur_nom || '?')[0].toUpperCase()}</span>
          <span><b>{x.auteur_nom || 'Compte supprimé'}</b><span className="discret"> {x.auteur_role ? `· ${ROLES[x.auteur_role] || x.auteur_role}` : ''}{x.auteur_iepp ? ` · ${x.auteur_iepp}` : ''}</span></span>
          <span className="discret mf-date">{quand(x.created_at)}{x.modifie_le ? ' (modifié)' : ''}</span>
        </div>
        <div className="mf-corps">{x.contenu}</div>
        {peutModifier(x) && (
          <div className="mf-actions">
            {x.auteur_id === profil.id && <button className="lien" onClick={() => setEdition({ type, id: x.id, titre: x.titre, contenu: x.contenu, categorie: x.categorie })}>Modifier</button>}
            <button className="lien danger" onClick={() => (type === 'sujet' ? supprimerSujet() : supprimerReponse(x))}>Supprimer</button>
          </div>
        )}
      </div>
    )
  );

  return (
    <div>
      <div className="barre-outils">
        <button className="btn-contour" onClick={retour}>← Tous les sujets</button>
        <div className="espace" />
        {moderateur && <button className="btn-contour" onClick={() => basculer('epingle')}>{s.epingle ? 'Désépingler' : '📌 Épingler'}</button>}
        {moderateur && <button className="btn-contour" onClick={() => basculer('verrouille')}>{s.verrouille ? 'Rouvrir' : '🔒 Fermer le sujet'}</button>}
      </div>
      <h2 className="titre-sujet">{s.epingle && '📌 '}{s.verrouille && '🔒 '}{s.titre} <span className="badge">{s.categorie}</span></h2>
      {msg && <p className="erreur">{msg}</p>}
      {message(s, 'sujet')}
      {reponses.length > 0 && <h3 className="nb-reponses">{reponses.length} réponse{reponses.length > 1 ? 's' : ''}</h3>}
      {reponses.map((r) => <div key={r.id}>{message(r, 'reponse')}</div>)}
      {s.verrouille && !moderateur
        ? <p className="alerte">🔒 Ce sujet est fermé : on ne peut plus y répondre.</p>
        : (
          <form className="carte redaction" onSubmit={repondre}>
            <label>Votre réponse<textarea rows={4} value={texte} onChange={(e) => setTexte(e.target.value)} required placeholder="Écrivez votre réponse…" /></label>
            <div className="actions"><button className="btn">Répondre</button></div>
          </form>
        )}
    </div>
  );
}
