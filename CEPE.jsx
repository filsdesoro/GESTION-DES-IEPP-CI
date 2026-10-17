import { useCallback, useEffect, useState } from 'react';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur, uid } from './supabase';
import Crud from './Crud.jsx';
import { ChoixEcoleClasse, dateFr, fmt, nomComplet, useEcoles, useListe } from './Choix.jsx';
import { EnTeteOfficiel } from './Releves.jsx';
import { usePersonnelIepp } from './Secteurs.jsx';

export default function CEPE() {
  const { peutGerer, annee } = useApp();
  const onglets = [['candidats', 'Candidats par école'], ['convocations', 'Convocations']];
  if (peutGerer) onglets.unshift(['centres', 'Centres d’examen']);
  if (peutGerer) onglets.push(['numeros', 'Numéros de table'], ['resultats', 'Résultats']);
  const [onglet, setOnglet] = useState(onglets[0][0]);
  if (!annee) return <div><h1>Convocations CEPE</h1><p className="vide">Aucune année scolaire active.</p></div>;
  return (
    <div>
      <h1 className="non-imprime">CEPE {annee.libelle}</h1>
      <div className="onglets non-imprime">
        {onglets.map(([k, l]) => <button key={k} className={onglet === k ? 'actif' : ''} onClick={() => setOnglet(k)}>{l}</button>)}
      </div>
      {onglet === 'centres' && <Centres />}
      {onglet === 'candidats' && <Candidats />}
      {onglet === 'numeros' && <Numeros />}
      {onglet === 'convocations' && <Convocations />}
      {onglet === 'resultats' && <Resultats />}
    </div>
  );
}

function useCentres() {
  const { ieppId, annee } = useApp();
  return useListe('cepe_centres', { select: '*, ecoles(nom)', filtre: { iepp_id: ieppId, annee_id: annee?.id || null }, ordre: 'nom' });
}

/** Candidats d'un centre avec élève, classe et école. */
function useCandidatsCentre(centreId) {
  const [liste, setListe] = useState([]);
  const charger = useCallback(async () => {
    if (!centreId) { setListe([]); return; }
    const { data } = await supabase.from('cepe_candidats')
      .select('*, inscriptions(id, eleves(*), classes(nom, ecoles(id, nom)))').eq('centre_id', centreId);
    setListe((data || []).filter((c) => c.inscriptions?.eleves).sort((a, b) =>
      (a.inscriptions.classes?.ecoles?.nom || '').localeCompare(b.inscriptions.classes?.ecoles?.nom || '') || nomComplet(a.inscriptions.eleves).localeCompare(nomComplet(b.inscriptions.eleves))));
  }, [centreId]);
  useEffect(() => { charger(); }, [charger]);
  return [liste, charger];
}

function ChoixCentre({ valeur, changer }) {
  const centres = useCentres();
  useEffect(() => { if (!valeur && centres.length) changer(centres[0].id); }, [centres]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="choix-ligne">
      <label>Centre d'examen
        <select value={valeur || ''} onChange={(e) => changer(e.target.value)}>
          {centres.length === 0 && <option value="">Aucun centre créé</option>}
          {centres.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </label>
    </div>
  );
}

function Centres() {
  const { ieppId, annee } = useApp();
  const ecoles = useEcoles();
  const personnel = usePersonnelIepp();
  return (
    <Crud table="cepe_centres" filtre={{ iepp_id: ieppId, annee_id: annee.id }} select="*, ecoles(nom), chef:personnel(nom, prenoms)"
      champs={[
        { nom: 'nom', label: 'Nom du centre', requis: true },
        { nom: 'ecole_id', label: 'École abritant le centre', type: 'select', options: ecoles.map((e) => ({ value: e.id, label: e.nom })) },
        { nom: 'chef_centre_id', label: 'Chef de centre', type: 'select', options: personnel.map((p) => ({ value: p.id, label: nomComplet(p) })) },
        { nom: 'capacite', label: 'Capacité (candidats)', type: 'number' },
      ]}
      colonnes={[
        { cle: 'nom', label: 'Centre', rendu: (l) => <b>{l.nom}</b> },
        { cle: 'ecole', label: 'Lieu', rendu: (l) => l.ecoles?.nom },
        { cle: 'chef', label: 'Chef de centre', rendu: (l) => nomComplet(l.chef) },
        { cle: 'capacite', label: 'Capacité' },
      ]}
    />
  );
}

function Candidats() {
  const { annee, role } = useApp();
  const centres = useCentres();
  const [choix, setChoix] = useState({ ecoleId: null, classeId: null });
  const [lignes, setLignes] = useState([]);
  const [msg, setMsg] = useState('');
  const modifiable = role !== 'conseiller';

  const charger = useCallback(async () => {
    if (!choix.ecoleId) { setLignes([]); return; }
    const { data } = await supabase.from('inscriptions')
      .select('id, statut, eleves(*), classes!inner(nom, niveau_code, ecole_id), cepe_candidats(*)')
      .eq('annee_id', annee.id).eq('classes.ecole_id', choix.ecoleId).eq('classes.niveau_code', 'CM2');
    setLignes((data || []).filter((i) => i.eleves).sort((a, b) => nomComplet(a.eleves).localeCompare(nomComplet(b.eleves))));
  }, [choix.ecoleId, annee]);
  useEffect(() => { charger(); }, [charger]);

  const candidat = (i) => (Array.isArray(i.cepe_candidats) ? i.cepe_candidats[0] : i.cepe_candidats);

  async function inscrireTous() {
    const nouveaux = lignes.filter((i) => !candidat(i)).map((i) => ({ id: uid(), inscription_id: i.id, centre_id: centreParDefaut || null }));
    if (!nouveaux.length) return setMsg('Tous les élèves de CM2 sont déjà inscrits.');
    const { error } = await supabase.from('cepe_candidats').insert(nouveaux);
    setMsg(error ? traduireErreur(error) : `${nouveaux.length} candidat(s) inscrit(s).`);
    charger();
  }

  async function basculer(i) {
    const c = candidat(i);
    const res = c ? await supabase.from('cepe_candidats').delete().eq('id', c.id) : await supabase.from('cepe_candidats').insert({ id: uid(), inscription_id: i.id, centre_id: centreParDefaut || null });
    if (res.error) setMsg(traduireErreur(res.error));
    charger();
  }

  async function majCandidat(c, champ, valeur) {
    const { error } = await supabase.from('cepe_candidats').update({ [champ]: valeur }).eq('id', c.id);
    if (error) setMsg(traduireErreur(error));
    charger();
  }

  async function affecterCentre(centreId) {
    const ids = lignes.map(candidat).filter(Boolean).map((c) => c.id);
    if (!ids.length) return;
    const { error } = await supabase.from('cepe_candidats').update({ centre_id: centreId || null }).in('id', ids);
    setMsg(error ? traduireErreur(error) : 'Centre affecté à tous les candidats de l’école.');
    charger();
  }

  const centreParDefaut = centres.find((c) => c.ecole_id === choix.ecoleId)?.id || centres[0]?.id;
  const nbCand = lignes.filter(candidat).length;

  return (
    <>
      <ChoixEcoleClasse valeur={choix} changer={setChoix} sansClasse />
      {choix.ecoleId && (
        <>
          <div className="barre-outils">
            <span className="discret">{lignes.length} élève(s) de CM2 · {nbCand} candidat(s)</span>
            <div className="espace" />
            {modifiable && role !== 'saisie' && (
              <select onChange={(e) => e.target.value && affecterCentre(e.target.value)} value="">
                <option value="">Affecter tous à un centre…</option>
                {centres.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            )}
            {modifiable && <button className="btn" onClick={inscrireTous}>Inscrire tous les CM2</button>}
          </div>
          {msg && <p className="succes">{msg}</p>}
          <div className="tableau-cadre">
            <table className="tableau">
              <thead><tr><th>Candidat</th><th>Nom et prénoms</th><th>Classe</th><th>Né(e) le</th><th>Extrait</th><th>Centre</th><th>N° table</th><th>Apte EPS</th></tr></thead>
              <tbody>
                {lignes.length === 0 && <tr><td colSpan={8} className="vide">Aucun élève de CM2 dans cette école.</td></tr>}
                {lignes.map((i) => {
                  const c = candidat(i);
                  return (
                    <tr key={i.id}>
                      <td><input type="checkbox" disabled={!modifiable} checked={!!c} onChange={() => basculer(i)} /></td>
                      <td className="nom">{nomComplet(i.eleves)}</td>
                      <td>{i.classes.nom}</td>
                      <td>{dateFr(i.eleves.date_naissance)}</td>
                      <td>{i.eleves.extrait_naissance ? '✓' : <span className="badge orange">Manquant</span>}</td>
                      <td>{c && (
                        <select disabled={!modifiable} value={c.centre_id || ''} onChange={(e) => majCandidat(c, 'centre_id', e.target.value || null)}>
                          <option value="">—</option>
                          {centres.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                        </select>
                      )}</td>
                      <td>{c?.numero_table}</td>
                      <td>{c && <input type="checkbox" disabled={!modifiable} checked={!!c.epreuve_eps} onChange={(e) => majCandidat(c, 'epreuve_eps', e.target.checked)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Numeros() {
  const [centreId, setCentreId] = useState(null);
  const [liste, charger] = useCandidatsCentre(centreId);
  const [prefixe, setPrefixe] = useState('');
  const [debut, setDebut] = useState(1);
  const [msg, setMsg] = useState('');

  async function numeroter() {
    if (!liste.length) return;
    if (!confirm(`Attribuer des numéros de table aux ${liste.length} candidats de ce centre (ordre : école puis nom) ? Les numéros existants seront remplacés.`)) return;
    const vider = liste.map((c) => ({ id: c.id, inscription_id: c.inscription_id, numero_table: null }));
    let r = await supabase.from('cepe_candidats').upsert(vider);
    if (r.error) return setMsg(traduireErreur(r.error));
    const largeur = String(Number(debut) + liste.length).length;
    const nums = liste.map((c, k) => ({ id: c.id, inscription_id: c.inscription_id, numero_table: `${prefixe}${String(Number(debut) + k).padStart(Math.max(3, largeur), '0')}` }));
    r = await supabase.from('cepe_candidats').upsert(nums);
    setMsg(r.error ? traduireErreur(r.error) : `${nums.length} numéros attribués.`);
    charger();
  }

  return (
    <>
      <ChoixCentre valeur={centreId} changer={setCentreId} />
      <div className="barre-outils">
        <label className="en-ligne">Préfixe <input className="moyen" value={prefixe} onChange={(e) => setPrefixe(e.target.value.toUpperCase())} placeholder="ex. AG1-" /></label>
        <label className="en-ligne">Premier numéro <input className="petit" type="number" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
        <div className="espace" />
        <button className="btn" onClick={numeroter} disabled={!liste.length}>Numéroter les {liste.length} candidats</button>
      </div>
      {msg && <p className="succes">{msg}</p>}
      <ListeCandidats liste={liste} />
    </>
  );
}

function ListeCandidats({ liste, extra }) {
  return (
    <div className="tableau-cadre">
      <table className="tableau">
        <thead><tr><th>N° table</th><th>Nom et prénoms</th><th>Sexe</th><th>Né(e) le</th><th>École</th>{extra?.entetes}</tr></thead>
        <tbody>
          {liste.length === 0 && <tr><td colSpan={5 + (extra?.nb || 0)} className="vide">Aucun candidat dans ce centre.</td></tr>}
          {liste.map((c) => (
            <tr key={c.id}>
              <td><b>{c.numero_table}</b></td>
              <td className="nom">{nomComplet(c.inscriptions.eleves)}</td>
              <td>{c.inscriptions.eleves.sexe}</td>
              <td>{dateFr(c.inscriptions.eleves.date_naissance)}</td>
              <td>{c.inscriptions.classes?.ecoles?.nom}</td>
              {extra?.cellules(c)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Convocations() {
  const { iepp, annee, profil } = useApp();
  const ecoles = useEcoles();
  const centres = useCentres();
  const [mode, setMode] = useState(['directeur', 'saisie', 'enseignant'].includes(profil.role) ? 'ecole' : 'centre');
  const [centreId, setCentreId] = useState(null);
  const [ecoleId, setEcoleId] = useState(null);
  const [liste, setListe] = useState([]);
  const [dateExamen, setDateExamen] = useState('');

  useEffect(() => {
    const charger = async () => {
      let q = supabase.from('cepe_candidats').select('*, cepe_centres(nom, ecoles(nom, localite)), inscriptions!inner(id, eleves(*), classes!inner(nom, annee_id, ecole_id, ecoles(nom)))');
      if (mode === 'centre') { if (!centreId) return setListe([]); q = q.eq('centre_id', centreId); }
      else { if (!ecoleId) return setListe([]); q = q.eq('inscriptions.classes.ecole_id', ecoleId).eq('inscriptions.classes.annee_id', annee.id); }
      const { data } = await q;
      setListe((data || []).filter((c) => c.inscriptions?.eleves).sort((a, b) => String(a.numero_table || 'zz').localeCompare(String(b.numero_table || 'zz')) || nomComplet(a.inscriptions.eleves).localeCompare(nomComplet(b.inscriptions.eleves))));
    };
    charger();
  }, [mode, centreId, ecoleId, annee]);

  useEffect(() => { if (!centreId && centres.length) setCentreId(centres[0].id); }, [centres, centreId]);
  useEffect(() => { if (!ecoleId && ecoles.length === 1) setEcoleId(ecoles[0].id); }, [ecoles, ecoleId]);

  return (
    <>
      <div className="non-imprime">
        <div className="choix-ligne">
          {!['directeur', 'saisie', 'enseignant'].includes(profil.role) && (
            <label>Imprimer par
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="centre">Centre d'examen</option>
                <option value="ecole">École</option>
              </select>
            </label>
          )}
          {mode === 'centre' ? (
            <label>Centre
              <select value={centreId || ''} onChange={(e) => setCentreId(e.target.value)}>
                {centres.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </label>
          ) : (
            <label>École
              <select value={ecoleId || ''} onChange={(e) => setEcoleId(e.target.value)}>
                <option value="">— choisir —</option>
                {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
              </select>
            </label>
          )}
          <label>Date de l'examen (texte libre)<input value={dateExamen} onChange={(e) => setDateExamen(e.target.value)} placeholder="ex. du 9 au 11 juin 2027" /></label>
        </div>
        <div className="barre-outils">
          <span className="discret">{liste.length} convocation(s){liste.some((c) => !c.numero_table) ? ' — certains candidats n’ont pas encore de numéro de table' : ''}</span>
          <div className="espace" />
          <button className="btn" disabled={!liste.length} onClick={() => window.print()}>Imprimer les convocations</button>
        </div>
      </div>
      <div className="planche-convocations">
        {liste.map((c) => {
          const e = c.inscriptions.eleves;
          return (
            <section key={c.id} className="convocation">
              <EnTeteOfficiel iepp={iepp} droite={<div>Session {annee.libelle.split('-').pop()}</div>} />
              <h2 className="titre-doc">CONVOCATION — CEPE</h2>
              <div className="conv-grille">
                <div>N° de table : <b className="gros">{c.numero_table || '………'}</b></div>
                <div>Nom et prénoms : <b>{nomComplet(e)}</b></div>
                <div>Né(e) le : <b>{dateFr(e.date_naissance) || '………'}</b> à <b>{e.lieu_naissance || '………'}</b></div>
                <div>Sexe : <b>{e.sexe}</b></div>
                <div>École d'origine : <b>{c.inscriptions.classes?.ecoles?.nom}</b></div>
                <div>Centre d'examen : <b>{c.cepe_centres?.nom || '………'}</b>{c.cepe_centres?.ecoles?.nom ? ` (${c.cepe_centres.ecoles.nom})` : ''}</div>
                <div>Épreuve d'EPS : <b>{c.epreuve_eps ? 'Apte' : 'Dispensé(e)'}</b></div>
                {dateExamen && <div>Date : <b>{dateExamen}</b></div>}
              </div>
              <p className="conv-note">Le candidat doit se présenter au centre muni de la présente convocation et de son extrait d'acte de naissance, 30 minutes avant le début des épreuves.</p>
              <div className="signatures"><div>Signature du candidat</div><div>L'Inspecteur de l'Enseignement Préscolaire et Primaire</div></div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Resultats() {
  const [centreId, setCentreId] = useState(null);
  const [liste, charger] = useCandidatsCentre(centreId);
  const [vals, setVals] = useState({});
  const [seuil, setSeuil] = useState(85);
  const [msg, setMsg] = useState('');

  useEffect(() => { setVals(Object.fromEntries(liste.map((c) => [c.id, { total_points: c.total_points ?? '', admis: c.admis }]))); }, [liste]);

  async function enregistrer() {
    const lignes = liste.map((c) => {
      const v = vals[c.id] || {};
      const pts = v.total_points === '' || v.total_points === null ? null : Number(v.total_points);
      return { id: c.id, inscription_id: c.inscription_id, total_points: pts, admis: pts === null ? v.admis ?? null : v.admis ?? pts >= seuil };
    });
    const { error } = await supabase.from('cepe_candidats').upsert(lignes);
    setMsg(error ? traduireErreur(error) : 'Résultats enregistrés.');
    charger();
  }

  function appliquerSeuil() {
    setVals((v) => Object.fromEntries(Object.entries(v).map(([id, x]) => [id, { ...x, admis: x.total_points === '' ? null : Number(x.total_points) >= seuil }])));
  }

  const admis = Object.values(vals).filter((v) => v.admis).length;
  return (
    <>
      <ChoixCentre valeur={centreId} changer={setCentreId} />
      <div className="barre-outils">
        <label className="en-ligne">Seuil d'admission (TGP) <input className="petit" type="number" value={seuil} onChange={(e) => setSeuil(Number(e.target.value))} /></label>
        <button className="btn-contour" onClick={appliquerSeuil}>Appliquer le seuil</button>
        <div className="espace" />
        <span className="discret">{admis} admis / {liste.length} ({liste.length ? fmt((100 * admis) / liste.length, 1) : 0} %)</span>
        <button className="btn-contour" onClick={() => window.print()}>Imprimer</button>
        <button className="btn" onClick={enregistrer}>Enregistrer</button>
      </div>
      {msg && <p className="succes">{msg}</p>}
      <ListeCandidats liste={liste} extra={{
        nb: 2,
        entetes: <><th>TGP</th><th>Admis</th></>,
        cellules: (c) => (
          <>
            <td><input className="petit" type="number" value={vals[c.id]?.total_points ?? ''} onChange={(e) => setVals((v) => ({ ...v, [c.id]: { ...v[c.id], total_points: e.target.value } }))} /></td>
            <td><input type="checkbox" checked={!!vals[c.id]?.admis} onChange={(e) => setVals((v) => ({ ...v, [c.id]: { ...v[c.id], admis: e.target.checked } }))} /></td>
          </>
        ),
      }} />
    </>
  );
}
