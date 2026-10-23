import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { ChoixModele } from './Modeles.jsx';

const MANQUE_SCRIPT = 'La messagerie n’est pas encore installée : lancez le script 021_messagerie.sql dans Supabase (SQL Editor).';
const erreurLisible = (e) => (/function|schema cache|relation .* does not exist/i.test(e?.message || '') ? MANQUE_SCRIPT : traduireErreur(e));

/** Nombre de messages non lus, rafraîchi chaque minute (pour le menu). */
export function useNonLus(actif) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!actif) return;
    let arret = false;
    const lire = () => supabase.rpc('messages_non_lus').then(({ data, error }) => { if (!arret && !error) setN(data || 0); });
    lire();
    const t = setInterval(lire, 60000);
    window.addEventListener('gestion-iepp:messages', lire);
    return () => { arret = true; clearInterval(t); window.removeEventListener('gestion-iepp:messages', lire); };
  }, [actif]);
  return n;
}
const prevenirMenu = () => window.dispatchEvent(new Event('gestion-iepp:messages'));

function quand(d) {
  const x = new Date(d);
  const auj = new Date();
  if (x.toDateString() === auj.toDateString()) return x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: x.getFullYear() === auj.getFullYear() ? undefined : '2-digit' });
}
const chiffres = (t) => (t || '').replace(/[^0-9+]/g, '');

export default function Messagerie() {
  const { profil } = useApp();
  const [onglet, setOnglet] = useState('recus');
  const [recus, setRecus] = useState(null);
  const [envoyes, setEnvoyes] = useState(null);
  const [carnet, setCarnet] = useState([]);
  const [ouvert, setOuvert] = useState(null);
  const [brouillon, setBrouillon] = useState(null);
  const [erreur, setErreur] = useState('');
  const [texte, setTexte] = useState('');

  const charger = useCallback(async () => {
    const [r, e, c] = await Promise.all([
      supabase.from('message_destinataires').select('message_id, lu_le, messages(*)').eq('destinataire_id', profil.id).eq('supprime', false),
      supabase.from('messages').select('*, message_destinataires(destinataire_id, lu_le)').eq('expediteur_id', profil.id).eq('supprime_expediteur', false),
      supabase.rpc('destinataires_possibles'),
    ]);
    const err = r.error || e.error || c.error;
    if (err) { setErreur(erreurLisible(err)); setRecus([]); setEnvoyes([]); return; }
    setErreur('');
    setRecus((r.data || []).filter((x) => x.messages).sort((a, b) => b.messages.created_at.localeCompare(a.messages.created_at)));
    setEnvoyes((e.data || []).sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setCarnet(c.data || []);
  }, [profil.id]);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 60000);
    return () => clearInterval(t);
  }, [charger]);

  const parId = useMemo(() => Object.fromEntries(carnet.map((p) => [p.id, p])), [carnet]);
  const nonLus = (recus || []).filter((x) => !x.lu_le).length;

  async function lire(item) {
    setOuvert({ type: 'recu', item });
    if (!item.lu_le) {
      await supabase.from('message_destinataires').update({ lu_le: new Date().toISOString() }).eq('message_id', item.message_id).eq('destinataire_id', profil.id);
      setRecus((l) => l.map((x) => (x.message_id === item.message_id ? { ...x, lu_le: new Date().toISOString() } : x)));
      prevenirMenu();
    }
  }
  async function marquerNonLu(item) {
    await supabase.from('message_destinataires').update({ lu_le: null }).eq('message_id', item.message_id).eq('destinataire_id', profil.id);
    setOuvert(null); prevenirMenu(); charger();
  }
  async function supprimer() {
    if (!confirm('Supprimer ce message de votre boîte ?')) return;
    const { type, item } = ouvert;
    const r = type === 'recu'
      ? await supabase.from('message_destinataires').update({ supprime: true }).eq('message_id', item.message_id).eq('destinataire_id', profil.id)
      : await supabase.from('messages').update({ supprime_expediteur: true }).eq('id', item.id);
    if (r.error) return alert(erreurLisible(r.error));
    setOuvert(null); prevenirMenu(); charger();
  }

  function repondre(tous) {
    const m = ouvert.type === 'recu' ? ouvert.item.messages : ouvert.item;
    let ids = ouvert.type === 'recu' ? [m.expediteur_id] : m.message_destinataires.map((d) => d.destinataire_id);
    if (tous && ouvert.type === 'recu') ids = [m.expediteur_id];
    const objet = /^re\s*:/i.test(m.objet) ? m.objet : `RE : ${m.objet}`;
    const cite = `\n\n----- Message de ${m.expediteur_nom || '—'} du ${new Date(m.created_at).toLocaleString('fr-FR')} -----\n${m.corps}`;
    setBrouillon({ dest: ids.filter((x) => x && parId[x]), objet, corps: cite, reponse_a: m.id });
    setOuvert(null);
    setOnglet('nouveau');
  }

  const t = texte.trim().toLowerCase();
  const filtreRecus = (recus || []).filter((x) => !t || `${x.messages.objet} ${x.messages.corps} ${x.messages.expediteur_nom}`.toLowerCase().includes(t));
  const nomsDest = (m) => m.message_destinataires.map((d) => parId[d.destinataire_id]?.nom_complet || '—').join(', ');
  const filtreEnvoyes = (envoyes || []).filter((m) => !t || `${m.objet} ${m.corps} ${nomsDest(m)}`.toLowerCase().includes(t));

  return (
    <div className="messagerie">
      <div className="titre-ligne">
        <h1>Messagerie</h1>
        <button className="btn" onClick={() => { setBrouillon({ dest: [], objet: '', corps: '' }); setOuvert(null); setOnglet('nouveau'); }}>✉️ Nouveau message</button>
      </div>
      {erreur && <div className="alerte">{erreur}</div>}

      <div className="onglets">
        <button className={onglet === 'recus' ? 'actif' : ''} onClick={() => { setOnglet('recus'); setOuvert(null); }}>Boîte de réception{nonLus ? ` (${nonLus})` : ''}</button>
        <button className={onglet === 'envoyes' ? 'actif' : ''} onClick={() => { setOnglet('envoyes'); setOuvert(null); }}>Messages envoyés</button>
        <button className={onglet === 'nouveau' ? 'actif' : ''} onClick={() => { if (!brouillon) setBrouillon({ dest: [], objet: '', corps: '' }); setOnglet('nouveau'); }}>Écrire</button>
      </div>

      {onglet === 'nouveau' && (
        <Redaction carnet={carnet} profil={profil} brouillon={brouillon || { dest: [], objet: '', corps: '' }} changer={setBrouillon}
          apresEnvoi={() => { setBrouillon(null); charger(); }} />
      )}

      {onglet !== 'nouveau' && ouvert && (
        <Lecture ouvert={ouvert} parId={parId} profil={profil} fermer={() => setOuvert(null)} repondre={repondre}
          supprimer={supprimer} marquerNonLu={marquerNonLu} />
      )}

      {onglet !== 'nouveau' && !ouvert && (
        <>
          <div className="barre-outils">
            <input className="recherche" placeholder="Rechercher dans les messages…" value={texte} onChange={(e) => setTexte(e.target.value)} />
            <div className="espace" />
            <button className="btn-contour" onClick={charger}>⟳ Actualiser</button>
          </div>
          {onglet === 'recus' && (recus === null ? <p>Chargement…</p> : (
            <div className="liste-messages carte">
              {filtreRecus.length === 0 && <p className="vide">Aucun message reçu.</p>}
              {filtreRecus.map((x) => (
                <button key={x.message_id} className={`ligne-message ${x.lu_le ? '' : 'non-lu'}`} onClick={() => lire(x)}>
                  <span className="lm-qui">{!x.lu_le && <span className="point-non-lu" />}{x.messages.expediteur_nom || '—'}</span>
                  <span className="lm-objet"><b>{x.messages.objet}</b> <span className="discret">— {x.messages.corps.slice(0, 90)}</span></span>
                  <span className="lm-date">{quand(x.messages.created_at)}</span>
                </button>
              ))}
            </div>
          ))}
          {onglet === 'envoyes' && (envoyes === null ? <p>Chargement…</p> : (
            <div className="liste-messages carte">
              {filtreEnvoyes.length === 0 && <p className="vide">Aucun message envoyé.</p>}
              {filtreEnvoyes.map((m) => {
                const lus = m.message_destinataires.filter((d) => d.lu_le).length;
                return (
                  <button key={m.id} className="ligne-message" onClick={() => setOuvert({ type: 'envoye', item: m })}>
                    <span className="lm-qui">À : {nomsDest(m)}</span>
                    <span className="lm-objet"><b>{m.objet}</b> <span className="discret">— lu par {lus}/{m.message_destinataires.length}</span></span>
                    <span className="lm-date">{quand(m.created_at)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Lecture({ ouvert, parId, profil, fermer, repondre, supprimer, marquerNonLu }) {
  const recu = ouvert.type === 'recu';
  const m = recu ? ouvert.item.messages : ouvert.item;
  const exp = parId[m.expediteur_id];
  return (
    <div className="carte lecture-message">
      <div className="barre-outils">
        <button className="btn-contour" onClick={fermer}>← Retour</button>
        <div className="espace" />
        {recu && exp && <button className="btn" onClick={() => repondre(false)}>↩ Répondre</button>}
        {!recu && <button className="btn" onClick={() => repondre(true)}>✉️ Écrire de nouveau à ces personnes</button>}
        {recu && <button className="btn-contour" onClick={() => marquerNonLu(ouvert.item)}>Marquer non lu</button>}
        <button className="btn-contour danger" onClick={supprimer}>Supprimer</button>
      </div>
      <h2>{m.objet}</h2>
      <div className="discret entete-message">
        <div>De : <b>{m.expediteur_id === profil.id ? 'moi' : (m.expediteur_nom || '—')}</b>{exp && ` (${ROLES[exp.role] || exp.role}${exp.iepp ? ` — ${exp.iepp}` : ''})`}</div>
        {!recu && <div>À : {m.message_destinataires.map((d) => (
          <span key={d.destinataire_id} className="badge">{parId[d.destinataire_id]?.nom_complet || '—'} {d.lu_le ? '✓ lu' : '· non lu'}</span>
        ))}</div>}
        <div>Le {new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}</div>
      </div>
      <div className="corps-message">{m.corps}</div>
      {recu && exp && (exp.telephone || exp.email) && (
        <div className="contact-rapide">
          Contacter {exp.nom_complet} directement :
          {exp.telephone && <> <a className="btn-contour" href={`tel:${chiffres(exp.telephone)}`}>📞 Appeler</a> <a className="btn-contour" href={`sms:${chiffres(exp.telephone)}`}>📱 SMS</a></>}
          {exp.email && <> <a className="btn-contour" href={`mailto:${exp.email}?subject=${encodeURIComponent(`RE : ${m.objet}`)}`}>📧 E-mail</a></>}
        </div>
      )}
    </div>
  );
}

const GROUPES = [
  ['superviseur', 'L’administration du logiciel', (p) => p.role === 'superviseur'],
  ['inspecteurs', 'Tous les inspecteurs (IEPP)', (p) => p.role === 'iepp'],
  ['circ', 'Toute ma circonscription', (p, moi) => p.iepp_id && p.iepp_id === moi.iepp_id],
  ['conseillers', 'Conseillers de ma circonscription', (p, moi) => p.role === 'conseiller' && p.iepp_id === moi.iepp_id],
  ['directeurs', 'Directeurs de ma circonscription', (p, moi) => p.role === 'directeur' && p.iepp_id === moi.iepp_id],
  ['enseignants', 'Enseignants de ma circonscription', (p, moi) => p.role === 'enseignant' && p.iepp_id === moi.iepp_id],
];

function Redaction({ carnet, profil, brouillon, changer, apresEnvoi }) {
  const [cherche, setCherche] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [msg, setMsg] = useState('');
  const [envoye, setEnvoye] = useState(null);
  const choisis = new Set(brouillon.dest);
  const maj = (k, v) => changer({ ...brouillon, [k]: v });
  const basculer = (id) => maj('dest', choisis.has(id) ? brouillon.dest.filter((x) => x !== id) : [...brouillon.dest, id]);
  const groupes = GROUPES.map(([k, l, f]) => [k, l, carnet.filter((p) => f(p, profil))]).filter(([, , ids]) => ids.length);
  const ajouterGroupe = (liste) => {
    const tous = liste.every((p) => choisis.has(p.id));
    maj('dest', tous ? brouillon.dest.filter((x) => !liste.some((p) => p.id === x)) : [...new Set([...brouillon.dest, ...liste.map((p) => p.id)])]);
  };
  const t = cherche.trim().toLowerCase();
  const visibles = carnet.filter((p) => !t || `${p.nom_complet} ${ROLES[p.role] || ''} ${p.iepp || ''} ${p.ecole || ''} ${p.drena || ''}`.toLowerCase().includes(t));

  async function envoyer(e) {
    e.preventDefault();
    setMsg('');
    if (!brouillon.dest.length) return setMsg('Choisissez au moins un destinataire.');
    setEnvoi(true);
    const { error } = await supabase.rpc('envoyer_message', { p_objet: brouillon.objet, p_corps: brouillon.corps, p_destinataires: brouillon.dest, p_reponse_a: brouillon.reponse_a || null });
    setEnvoi(false);
    if (error) return setMsg(erreurLisible(error));
    const dest = carnet.filter((p) => choisis.has(p.id));
    setEnvoye({ objet: brouillon.objet, corps: brouillon.corps, dest });
    apresEnvoi();
  }

  if (envoye) {
    const tels = envoye.dest.map((p) => chiffres(p.telephone)).filter(Boolean);
    const mails = envoye.dest.map((p) => p.email).filter(Boolean);
    const texteSms = `${envoye.objet} : ${envoye.corps}`.slice(0, 600);
    return (
      <div className="carte envoi-ok">
        <h2>✓ Message envoyé à {envoye.dest.length} personne(s)</h2>
        <p className="discret">Ils le verront dans leur Messagerie (avec un compteur rouge dans le menu) dès leur prochaine connexion.</p>
        {(tels.length > 0 || mails.length > 0) && (
          <div className="contact-rapide">
            <p>Pour les prévenir aussi en dehors du logiciel (depuis votre téléphone ou votre messagerie habituelle) :</p>
            {tels.length > 0 && <a className="btn-contour" href={`sms:${tels.join(',')}?body=${encodeURIComponent(texteSms)}`}>📱 Envoyer aussi par SMS ({tels.length})</a>}
            {mails.length > 0 && <a className="btn-contour" href={`mailto:?bcc=${mails.join(',')}&subject=${encodeURIComponent(envoye.objet)}&body=${encodeURIComponent(envoye.corps)}`}>📧 Envoyer aussi par e-mail ({mails.length})</a>}
            <p className="discret">Le SMS part de votre propre téléphone (forfait habituel). Fonctionne surtout depuis un téléphone.</p>
          </div>
        )}
        <div className="actions"><button className="btn" onClick={() => { setEnvoye(null); changer({ dest: [], objet: '', corps: '' }); }}>Écrire un autre message</button></div>
      </div>
    );
  }

  return (
    <form className="carte redaction" onSubmit={envoyer}>
      <div className="champ-dest">
        <span className="libelle">À :</span>
        {brouillon.dest.length === 0 && <span className="discret">aucun destinataire — choisissez ci-dessous</span>}
        {brouillon.dest.map((id) => {
          const p = carnet.find((x) => x.id === id);
          return <span key={id} className="badge puce">{p?.nom_complet || '—'} <button type="button" onClick={() => basculer(id)} aria-label="Retirer">×</button></span>;
        })}
      </div>
      <div className="groupes-dest">
        {groupes.map(([k, l, liste]) => {
          const tous = liste.every((p) => choisis.has(p.id));
          return <button type="button" key={k} className={`btn-contour petit ${tous ? 'actif' : ''}`} onClick={() => ajouterGroupe(liste)}>{tous ? '✓ ' : '+ '}{l} ({liste.length})</button>;
        })}
      </div>
      <details className="carnet" open={!brouillon.dest.length}>
        <summary>Choisir des personnes ({carnet.length} dans votre carnet)</summary>
        <input className="recherche" placeholder="Rechercher (nom, rôle, IEPP, école)…" value={cherche} onChange={(e) => setCherche(e.target.value)} />
        <div className="liste-carnet">
          {visibles.length === 0 && <p className="discret">Personne à afficher.</p>}
          {visibles.map((p) => (
            <label key={p.id} className="case">
              <input type="checkbox" checked={choisis.has(p.id)} onChange={() => basculer(p.id)} />
              <span><b>{p.nom_complet}</b> <span className="discret">— {ROLES[p.role] || p.role}{p.iepp ? ` · ${p.iepp}` : ''}{p.ecole ? ` · ${p.ecole}` : ''}</span></span>
            </label>
          ))}
        </div>
      </details>
      <ChoixModele objet={brouillon.objet} corps={brouillon.corps} appliquer={(m) => changer({ ...brouillon, ...m })} />
      <label>Objet<input value={brouillon.objet} onChange={(e) => maj('objet', e.target.value)} maxLength={150} required /></label>
      <label>Message<textarea rows={9} value={brouillon.corps} onChange={(e) => maj('corps', e.target.value)} required /></label>
      {msg && <p className="erreur">{msg}</p>}
      <div className="actions">
        <button className="btn" disabled={envoi}>{envoi ? 'Envoi…' : `Envoyer${brouillon.dest.length ? ` à ${brouillon.dest.length} personne(s)` : ''}`}</button>
      </div>
    </form>
  );
}
