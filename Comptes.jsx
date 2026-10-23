import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ROLES, useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { FormulaireModal } from './Crud.jsx';
import Modal from './Modal.jsx';
import { useListe } from './Choix.jsx';
import { signalerSuppression } from './Corbeille.jsx';

const MOTIFS = [
  'Compte suspendu pour non-paiement de l\'abonnement.',
  'Compte suspendu : paiement de l\'abonnement en cours de vérification.',
  'Compte suspendu par l\'administrateur.',
];

function motDePasseProvisoire() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => c[x % c.length]).join('');
}

export default function Comptes() {
  const { role, ieppId, iepps, profil } = useApp();
  const [recherche, setRecherche] = useState(useLocation().state?.recherche || '');
  const [filtreIepp, setFiltreIepp] = useState('');
  const [filtreRole, setFiltreRole] = useState('');
  const [comptes, setComptes] = useState([]);
  const [emails, setEmails] = useState({});
  const [edition, setEdition] = useState(null);
  const [identifiants, setIdentifiants] = useState(null);
  const [msg, setMsg] = useState('');
  const secteurs = useListe('secteurs', { filtre: { iepp_id: edition?.iepp_id || ieppId }, ordre: 'nom' });
  const ecoles = useListe('ecoles', { select: 'id, nom', filtre: { iepp_id: edition?.iepp_id || ieppId }, ordre: 'nom' });
  const toutesEcoles = useListe('ecoles', { select: 'id, nom' });
  const tousSecteurs = useListe('secteurs', { select: 'id, nom' });

  const charger = useCallback(async () => {
    let q = supabase.from('profils').select('*').order('nom_complet');
    if (role === 'iepp') q = q.eq('iepp_id', ieppId);
    const { data, error } = await q;
    if (error) setMsg(traduireErreur(error));
    const attente = (c) => (!c.actif && /attente de validation/i.test(c.motif_blocage || '') ? 0 : 1);
    setComptes((data || []).sort((a, b) => attente(a) - attente(b)));
    const { data: em } = await supabase.rpc('comptes_emails');
    setEmails(Object.fromEntries((em || []).map((c) => [c.id, c.email])));
  }, [role, ieppId]);
  useEffect(() => { charger(); }, [charger]);

  const rolesPermis = role === 'superviseur' ? Object.keys(ROLES) : ['conseiller', 'directeur', 'saisie'];
  const r = edition?.role;
  const champs = [
    { nom: 'nom_complet', label: 'Nom complet', requis: true, pleine: true },
    ...(edition?.id ? [] : [{ nom: 'email', label: 'Email (identifiant de connexion)', type: 'email', requis: true }, { nom: 'mot_de_passe', label: 'Mot de passe provisoire', requis: true, aide: "À communiquer à l'utilisateur ; il pourra le changer." }]),
    { nom: 'role', label: 'Rôle', type: 'select', requis: true, options: rolesPermis.map((x) => ({ value: x, label: ROLES[x] })) },
    ...(role === 'superviseur' && r && r !== 'superviseur' ? [{ nom: 'iepp_id', label: 'Circonscription', type: 'select', requis: true, options: iepps.map((i) => ({ value: i.id, label: i.nom })) }] : []),
    ...(r === 'conseiller' ? [{ nom: 'secteur_id', label: 'Secteur pédagogique', type: 'select', requis: true, options: secteurs.map((s) => ({ value: s.id, label: s.nom })) }] : []),
    ...(r === 'directeur' || r === 'saisie' ? [{ nom: 'ecole_id', label: 'École', type: 'select', requis: true, options: ecoles.map((e) => ({ value: e.id, label: e.nom })) }] : []),
  ];

  function nettoyer(v) {
    const p = { nom_complet: v.nom_complet, role: v.role, iepp_id: null, secteur_id: null, ecole_id: null };
    if (v.role !== 'superviseur') p.iepp_id = role === 'superviseur' ? v.iepp_id : ieppId;
    if (v.role === 'conseiller') p.secteur_id = v.secteur_id;
    if (v.role === 'directeur' || v.role === 'saisie') p.ecole_id = v.ecole_id;
    return p;
  }

  async function enregistrer(v) {
    const p = nettoyer(v);
    if (v.id) {
      const { error } = await supabase.from('profils').update(p).eq('id', v.id);
      if (error) throw new Error(traduireErreur(error));
    } else {
      if (String(v.mot_de_passe).length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
      const { error } = await supabase.rpc('creer_compte', {
        p_email: v.email.trim().toLowerCase(), p_mot_de_passe: v.mot_de_passe, p_nom_complet: p.nom_complet, p_role: p.role,
        p_iepp: p.iepp_id, p_secteur: p.secteur_id, p_ecole: p.ecole_id,
      });
      if (error) throw new Error(traduireErreur(error));
      setIdentifiants({ nom: p.nom_complet, email: v.email.trim().toLowerCase(), mdp: v.mot_de_passe });
    }
    setEdition(null);
    charger();
  }

  const [blocage, setBlocage] = useState(null);
  async function basculer(c) {
    if (c.actif) return setBlocage({ compte: c, motif: MOTIFS[0] });
    const { error } = await supabase.from('profils').update({ actif: true, motif_blocage: null }).eq('id', c.id);
    if (error) setMsg(traduireErreur(error));
    charger();
  }
  async function bloquer(e) {
    e.preventDefault();
    const { error } = await supabase.from('profils').update({ actif: false, motif_blocage: blocage.motif?.trim() || null }).eq('id', blocage.compte.id);
    if (error) {
      // colonne motif absente (script 009 non lancé) : on bloque quand même
      const r = await supabase.from('profils').update({ actif: false }).eq('id', blocage.compte.id);
      if (r.error) setMsg(traduireErreur(r.error));
    }
    setBlocage(null);
    charger();
  }

  async function reinitialiser(c) {
    const mdp = motDePasseProvisoire();
    if (!confirm(`Générer un nouveau mot de passe pour ${c.nom_complet} ?`)) return;
    const { error } = await supabase.rpc('changer_mot_de_passe_compte', { p_id: c.id, p_mot_de_passe: mdp });
    if (error) return setMsg(traduireErreur(error));
    setIdentifiants({ nom: c.nom_complet, email: emails[c.id] || '', mdp });
  }

  async function supprimer(c) {
    if (!confirm(`Supprimer le compte de ${c.nom_complet} ?\n(Vous pourrez annuler, ou le restaurer depuis la Corbeille.)`)) return;
    const { error } = await supabase.rpc('supprimer_compte', { p_id: c.id });
    if (error) setMsg(traduireErreur(error)); else { signalerSuppression(`Compte de ${c.nom_complet}`); charger(); }
  }

  const nomIepp = (id) => iepps.find((i) => i.id === id)?.nom || '';
  const comptesVisibles = role === 'superviseur' ? comptes : comptes.filter((c) => c.role !== 'superviseur');
  const comptesFiltres = comptesVisibles.filter((c) => {
    const t = recherche.trim().toLowerCase();
    return (!filtreIepp || (filtreIepp === 'aucune' ? !c.iepp_id : c.iepp_id === filtreIepp))
      && (!filtreRole || c.role === filtreRole)
      && (!t || `${c.nom_complet} ${emails[c.id] || ''} ${c.telephone || ''} ${ROLES[c.role] || ''} ${nomIepp(c.iepp_id)}`.toLowerCase().includes(t));
  });
  const portee = (c) => c.role === 'superviseur' ? 'Toutes les circonscriptions'
    : c.role === 'iepp' ? nomIepp(c.iepp_id)
      : c.role === 'conseiller' ? `Secteur ${tousSecteurs.find((s) => s.id === c.secteur_id)?.nom || ''}`
        : toutesEcoles.find((e) => e.id === c.ecole_id)?.nom || '';

  return (
    <div>
      <h1>Comptes utilisateurs</h1>
      {comptes.some((c) => !c.actif && /attente de validation/i.test(c.motif_blocage || '')) && (
        <div className="alerte">{comptes.filter((c) => !c.actif && /attente de validation/i.test(c.motif_blocage || '')).length} compte(s) créé(s) depuis la page de connexion attendent votre validation : vérifiez la personne puis cliquez sur « Valider ».</div>
      )}
      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher un compte (nom, email, téléphone, matricule, rôle)…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        {role === 'superviseur' && (
          <select value={filtreIepp} onChange={(e) => setFiltreIepp(e.target.value)} aria-label="Circonscription">
            <option value="">Toutes les circonscriptions</option>
            <option value="aucune">Sans circonscription (superviseurs)</option>
            {[...new Set(comptes.map((c) => c.iepp_id).filter(Boolean))].map((id) => ({ id, nom: nomIepp(id) || '—' }))
              .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((i) => <option key={i.id} value={i.id}>{i.nom} ({comptes.filter((c) => c.iepp_id === i.id).length})</option>)}
          </select>
        )}
        <select value={filtreRole} onChange={(e) => setFiltreRole(e.target.value)} aria-label="Rôle">
          <option value="">Tous les rôles</option>
          {Object.entries(ROLES).filter(([k]) => role === 'superviseur' || k !== 'superviseur').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="discret">{comptesFiltres.length} compte(s){comptesFiltres.length !== comptes.length ? ` sur ${comptes.length}` : ''}</span>
        <div className="espace" />
        <button className="btn" onClick={() => setEdition({ role: rolesPermis[rolesPermis.length - 2] || 'directeur', iepp_id: ieppId, mot_de_passe: motDePasseProvisoire() })}>+ Créer un compte</button>
      </div>
      {msg && <p className="erreur">{msg}</p>}
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Périmètre</th><th>État</th><th /></tr></thead>
          <tbody>
            {comptesFiltres.map((c) => (
              <tr key={c.id}>
                <td><b>{c.nom_complet}</b></td>
                <td>{emails[c.id]?.endsWith('@tel.gestion-iepp.ci') ? <>Tél. {emails[c.id].split('@')[0]}</> : emails[c.id]?.endsWith('@mat.gestion-iepp.ci') ? <>Matricule {emails[c.id].split('@')[0].toUpperCase()}</> : emails[c.id] || <span className="discret">—</span>}{c.telephone && !emails[c.id]?.startsWith(c.telephone.replace(/[^0-9]/g, '')) && <div className="discret">Tél. {c.telephone}</div>}</td>
                <td>{ROLES[c.role]}</td>
                <td>{portee(c)}</td>
                <td>{c.actif ? <span className="badge vert">Actif</span> : /attente de validation/i.test(c.motif_blocage || '') ? <span className="badge orange">À valider</span> : <><span className="badge rouge">Bloqué</span>{c.motif_blocage && <div className="discret">{c.motif_blocage}</div>}</>}</td>
                <td className="actions-ligne">
                  {c.id !== profil.id && (role === 'superviseur' || c.role !== 'superviseur') && (
                    <>
                      {c.role !== 'enseignant' && <button className="lien" onClick={() => setEdition({ ...c })}>Modifier</button>}
                      <button className="lien" onClick={() => reinitialiser(c)}>Nouveau mot de passe</button>
                      <button className="lien" onClick={() => basculer(c)}>{c.actif ? 'Bloquer' : /attente de validation/i.test(c.motif_blocage || '') ? 'Valider' : 'Débloquer'}</button>
                      <button className="lien danger" onClick={() => supprimer(c)}>Supprimer</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && <FormulaireModal titre={edition.id ? 'Modifier le compte' : 'Créer un compte'} champs={champs} initial={edition} fermer={() => setEdition(null)} enregistrer={enregistrer} surChangement={setEdition} key={edition.id || 'nouveau'} />}
      {blocage && (
        <Modal titre={`Bloquer ${blocage.compte.nom_complet}`} fermer={() => setBlocage(null)}>
          <form className="formulaire" onSubmit={bloquer}>
            <p className="discret">La personne ne pourra plus se connecter et verra le message ci-dessous.</p>
            <label><span>Motif</span>
              <select value={MOTIFS.includes(blocage.motif) ? blocage.motif : ''} onChange={(e) => setBlocage({ ...blocage, motif: e.target.value })}>
                {MOTIFS.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="">Autre motif…</option>
              </select>
            </label>
            <label><span>Message affiché à l'utilisateur</span>
              <textarea rows={3} value={blocage.motif} onChange={(e) => setBlocage({ ...blocage, motif: e.target.value })} />
            </label>
            <div className="actions">
              <button type="button" className="btn-contour" onClick={() => setBlocage(null)}>Annuler</button>
              <button className="btn danger">Bloquer le compte</button>
            </div>
          </form>
        </Modal>
      )}
      {identifiants && (
        <Modal titre="Identifiants à communiquer" fermer={() => setIdentifiants(null)}>
          <div className="identifiants">
            <p><b>{identifiants.nom}</b></p>
            <p>Adresse : <code>{window.location.origin}</code></p>
            <p>Email : <code>{identifiants.email}</code></p>
            <p>Mot de passe provisoire : <code>{identifiants.mdp}</code></p>
          </div>
          <p className="discret">Notez-les maintenant : le mot de passe ne sera plus affiché. L'utilisateur pourra le changer via « Mot de passe ».</p>
          <div className="actions">
            <button className="btn-contour" onClick={() => navigator.clipboard?.writeText(`Gestion IEPP\n${window.location.origin}\nEmail : ${identifiants.email}\nMot de passe : ${identifiants.mdp}`)}>Copier</button>
            <button className="btn" onClick={() => setIdentifiants(null)}>Fermer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
