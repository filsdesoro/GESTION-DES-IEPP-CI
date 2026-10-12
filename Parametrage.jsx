import { useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import Champs from './Formulaire.jsx';
import Crud from './Crud.jsx';
import { useListe, dateFr } from './Choix.jsx';

export default function Parametrage() {
  const { role } = useApp();
  const onglets = [['circ', 'Circonscription']];
  if (role === 'superviseur') onglets.push(['annees', 'Années scolaires'], ['drena', 'DRENA & circonscriptions'], ['bareme', 'Barème des matières']);
  const [onglet, setOnglet] = useState('circ');
  return (
    <div>
      <h1>Paramétrage circonscription</h1>
      <div className="onglets">
        {onglets.map(([k, l]) => <button key={k} className={onglet === k ? 'actif' : ''} onClick={() => setOnglet(k)}>{l}</button>)}
      </div>
      {onglet === 'circ' && <FicheCirconscription />}
      {onglet === 'annees' && <Annees />}
      {onglet === 'drena' && <DrenaIepp />}
      {onglet === 'bareme' && <Bareme />}
    </div>
  );
}

function FicheCirconscription() {
  const { iepp, recharger } = useApp();
  const [v, setV] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (iepp) setV({ ...iepp }); }, [iepp]);
  if (!iepp) return <p className="vide">Aucune circonscription. Le superviseur doit d'abord en créer une (onglet DRENA & circonscriptions).</p>;
  if (!v) return null;
  const champs = [
    { nom: 'nom', label: 'Nom de la circonscription', requis: true, pleine: true },
    { nom: 'localite', label: 'Localité' },
    { nom: 'boite_postale', label: 'Boîte postale' },
    { nom: 'telephone', label: 'Téléphone', type: 'tel' },
    { nom: 'email', label: 'Email', type: 'email' },
    { nom: 'logo_url', label: 'Adresse du logo (URL d’une image)', pleine: true },
  ];
  async function enregistrer(e) {
    e.preventDefault();
    const { nom, localite, boite_postale, telephone, email, logo_url } = v;
    const { error } = await supabase.from('iepp').update({ nom, localite, boite_postale, telephone, email, logo_url }).eq('id', iepp.id);
    setMsg(error ? traduireErreur(error) : 'Enregistré.');
    if (!error) recharger();
  }
  return (
    <form className="carte formulaire" onSubmit={enregistrer} style={{ maxWidth: 760 }}>
      <p className="discret">DRENA : {iepp.drena?.nom}</p>
      <Champs champs={champs} valeurs={v} changer={setV} />
      {msg && <p className={msg === 'Enregistré.' ? 'succes' : 'erreur'}>{msg}</p>}
      <div className="actions"><button className="btn">Enregistrer</button></div>
    </form>
  );
}

function Annees() {
  const { recharger } = useApp();
  const [cle, setCle] = useState(0);
  async function activer(a) {
    const r1 = await supabase.from('annees_scolaires').update({ active: false }).eq('active', true);
    const r2 = await supabase.from('annees_scolaires').update({ active: true }).eq('id', a.id);
    const err = r1.error || r2.error;
    if (err) alert(traduireErreur(err));
    setCle((k) => k + 1);
    recharger();
  }
  return (
    <Crud key={cle} table="annees_scolaires" ordre="date_debut"
      champs={[
        { nom: 'libelle', label: 'Libellé (ex. 2026-2027)', requis: true },
        { nom: 'date_debut', label: 'Date de rentrée', type: 'date', requis: true },
        { nom: 'date_fin', label: 'Date de fin', type: 'date', requis: true },
      ]}
      colonnes={[
        { cle: 'libelle', label: 'Année' },
        { cle: 'date_debut', label: 'Début', rendu: (l) => dateFr(l.date_debut) },
        { cle: 'date_fin', label: 'Fin', rendu: (l) => dateFr(l.date_fin) },
        { cle: 'active', label: 'État', rendu: (l) => (l.active ? <span className="badge vert">Active</span> : '') },
      ]}
      actionsLigne={(l) => !l.active && <button className="lien" onClick={() => activer(l)}>Activer</button>}
    />
  );
}

function DrenaIepp() {
  const { recharger } = useApp();
  const drenas = useListe('drena', { ordre: 'nom' });
  const [cle, setCle] = useState(0);
  return (
    <div className="deux-colonnes">
      <div>
        <h2>DRENA</h2>
        <Crud table="drena" ordre="nom"
          champs={[{ nom: 'nom', label: 'Nom (ex. DRENA Agboville)', requis: true }, { nom: 'code', label: 'Code' }, { nom: 'chef_lieu', label: 'Chef-lieu' }]}
          colonnes={[{ cle: 'nom', label: 'DRENA' }, { cle: 'chef_lieu', label: 'Chef-lieu' }]}
          avantSauvegarde={async (r) => { setTimeout(() => setCle((k) => k + 1), 300); return r; }}
        />
      </div>
      <div>
        <h2>Circonscriptions (IEPP)</h2>
        <Crud key={cle} table="iepp" ordre="nom" select="*, drena(nom)"
          champs={[
            { nom: 'drena_id', label: 'DRENA', type: 'select', requis: true, options: drenas.map((d) => ({ value: d.id, label: d.nom })) },
            { nom: 'nom', label: 'Nom (ex. IEPP Agboville 1)', requis: true },
            { nom: 'code', label: 'Code' },
            { nom: 'localite', label: 'Localité' },
          ]}
          colonnes={[{ cle: 'nom', label: 'Circonscription' }, { cle: 'drena', label: 'DRENA', rendu: (l) => l.drena?.nom }]}
          avantSauvegarde={async (r) => { setTimeout(recharger, 400); return r; }}
        />
      </div>
    </div>
  );
}

function Bareme() {
  const matieres = useListe('matieres', { ordre: 'ordre' });
  const niveaux = useListe('niveaux', { ordre: 'ordre' }).filter((n) => n.cycle === 'primaire');
  const [bareme, setBareme] = useState({});
  const [niveau, setNiveau] = useState('CM2');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.from('matieres_niveaux').select('*').then(({ data }) => {
      const b = {};
      (data || []).forEach((r) => { b[`${r.matiere_id}|${r.niveau_code}`] = r; });
      setBareme(b);
    });
  }, []);

  const maj = (mid, champ, val) => {
    const k = `${mid}|${niveau}`;
    setBareme((b) => ({ ...b, [k]: { ...(b[k] || { matiere_id: mid, niveau_code: niveau, note_sur: 10, coefficient: 1 }), [champ]: val } }));
  };

  async function enregistrer() {
    setMsg('');
    const garder = [];
    const retirer = [];
    matieres.forEach((m) => {
      const r = bareme[`${m.id}|${niveau}`];
      if (r && r.evaluee !== false) garder.push({ matiere_id: m.id, niveau_code: niveau, note_sur: Number(r.note_sur) || 10, coefficient: Number(r.coefficient) || 1 });
      else retirer.push(m.id);
    });
    if (garder.length) {
      const { error } = await supabase.from('matieres_niveaux').upsert(garder, { onConflict: 'matiere_id,niveau_code' });
      if (error) return setMsg(traduireErreur(error));
    }
    if (retirer.length) await supabase.from('matieres_niveaux').delete().eq('niveau_code', niveau).in('matiere_id', retirer);
    setMsg(`Barème ${niveau} enregistré.`);
  }

  async function copierPartout() {
    if (!confirm(`Appliquer le barème de ${niveau} à tous les niveaux du primaire ?`)) return;
    const lignes = [];
    matieres.forEach((m) => {
      const r = bareme[`${m.id}|${niveau}`];
      if (r && r.evaluee !== false) niveaux.forEach((n) => lignes.push({ matiere_id: m.id, niveau_code: n.code, note_sur: Number(r.note_sur) || 10, coefficient: Number(r.coefficient) || 1 }));
    });
    const { error } = await supabase.from('matieres_niveaux').upsert(lignes, { onConflict: 'matiere_id,niveau_code' });
    setMsg(error ? traduireErreur(error) : 'Barème copié sur tous les niveaux. Rechargez la page pour le voir.');
  }

  return (
    <div className="carte">
      <p>Cochez les matières évaluées pour chaque niveau, avec la note maximale et le coefficient. Les moyennes sont calculées sur 10.</p>
      <div className="onglets petits">
        {niveaux.map((n) => <button key={n.code} className={niveau === n.code ? 'actif' : ''} onClick={() => setNiveau(n.code)}>{n.code}</button>)}
      </div>
      <table className="tableau">
        <thead><tr><th>Évaluée</th><th>Matière</th><th>Note sur</th><th>Coefficient</th></tr></thead>
        <tbody>
          {matieres.map((m) => {
            const r = bareme[`${m.id}|${niveau}`];
            const actif = !!r && r.evaluee !== false;
            return (
              <tr key={m.id}>
                <td><input type="checkbox" checked={actif} onChange={(e) => maj(m.id, 'evaluee', e.target.checked)} /></td>
                <td>{m.libelle}</td>
                <td><input className="petit" type="number" disabled={!actif} value={r?.note_sur ?? 10} onChange={(e) => maj(m.id, 'note_sur', e.target.value)} /></td>
                <td><input className="petit" type="number" disabled={!actif} value={r?.coefficient ?? 1} onChange={(e) => maj(m.id, 'coefficient', e.target.value)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {msg && <p className="succes">{msg}</p>}
      <div className="actions">
        <button className="btn-contour" onClick={copierPartout}>Copier sur tous les niveaux</button>
        <button className="btn" onClick={enregistrer}>Enregistrer {niveau}</button>
      </div>
    </div>
  );
}
