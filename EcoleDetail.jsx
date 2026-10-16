import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import Crud, { FormulaireModal } from './Crud.jsx';
import { libelle } from './Formulaire.jsx';
import { nomComplet, useListe } from './Choix.jsx';
import { champsEcole } from './Ecoles.jsx';
import { usePersonnelIepp } from './Secteurs.jsx';

export default function EcoleDetail() {
  const { id } = useParams();
  const { annee, ieppId, role } = useApp();
  const [ecole, setEcole] = useState(null);
  const [edition, setEdition] = useState(false);
  const [effectifs, setEffectifs] = useState([]);
  const secteurs = useListe('secteurs', { filtre: { iepp_id: ieppId }, ordre: 'nom' });
  const niveaux = useListe('niveaux', { ordre: 'ordre' });
  const personnel = usePersonnelIepp();
  const peutModifier = role === 'superviseur' || role === 'iepp' || role === 'directeur';
  const peutClasses = role !== 'conseiller';

  const charger = useCallback(async () => {
    const { data } = await supabase.from('ecoles').select('*, secteurs(nom)').eq('id', id).maybeSingle();
    setEcole(data);
    const { data: ef } = await supabase.from('v_effectifs').select('*').eq('ecole_id', id).order('ordre');
    setEffectifs(ef || []);
  }, [id]);
  useEffect(() => { charger(); }, [charger]);

  if (!ecole) return <p className="discret">Chargement…</p>;
  const equipe = personnel.filter((p) => p.ecole_id === id);
  const directeur = equipe.find((p) => ['DIR_DECH', 'DIR_CLASSE'].includes(p.fonction_code));
  const total = effectifs.reduce((s, e) => ({ g: s.g + e.garcons, f: s.f + e.filles, t: s.t + e.total }), { g: 0, f: 0, t: 0 });
  const equip = [['a_cantine', 'Cantine'], ['a_latrines', 'Latrines'], ['a_point_eau', "Point d'eau"], ['a_electricite', 'Électricité'], ['a_cloture', 'Clôture']];

  async function enregistrer(v) {
    const autorises = champsEcole([]).map((c) => c.nom); // DRENA/IEPP non modifiables ici
    const maj = Object.fromEntries(Object.entries(v).filter(([k]) => autorises.includes(k)));
    const { error } = await supabase.from('ecoles').update(maj).eq('id', id);
    if (error) throw new Error(traduireErreur(error));
    setEdition(false);
    charger();
  }

  return (
    <div>
      <p><Link to="/ecoles">← Écoles</Link></p>
      <div className="titre-ligne">
        <h1>{ecole.nom}</h1>
        {peutModifier && <button className="btn-contour" onClick={() => setEdition(true)}>Modifier la fiche</button>}
      </div>
      <p className="sous-titre">
        {[ecole.code_ecole && `Code ${ecole.code_ecole}`, libelle('statut_ecole', ecole.statut), libelle('cycle_ecole', ecole.cycle), ecole.secteurs?.nom && `Secteur ${ecole.secteurs.nom}`, ecole.localite].filter(Boolean).join(' · ')}
      </p>
      <p className="ligne-directeur">Directeur : <b>{nomComplet(directeur) || 'non renseigné'}</b>{directeur?.telephone ? ` — ${directeur.telephone}` : ''}</p>

      <div className="chiffres">
        <div className="chiffre"><b>{total.t}</b><span>Élèves</span></div>
        <div className="chiffre"><b>{total.f}</b><span>Filles</span></div>
        <div className="chiffre"><b>{total.g}</b><span>Garçons</span></div>
        <div className="chiffre"><b>{equipe.length}</b><span>Personnel</span></div>
        <div className="chiffre"><b>{ecole.nb_salles ?? 0}</b><span>Salles ({ecole.nb_salles_bon_etat ?? 0} en bon état)</span></div>
        <div className="chiffre"><b>{ecole.nb_tables_bancs ?? 0}</b><span>Tables-bancs</span></div>
      </div>
      <p className="etiquettes">
        {equip.map(([k, l]) => <span key={k} className={`badge ${ecole[k] ? 'vert' : 'gris'}`}>{ecole[k] ? '✓' : '✗'} {l}</span>)}
      </p>

      <h2>Classes {annee ? `(${annee.libelle})` : ''}</h2>
      {annee ? (
        <Crud table="classes" filtre={{ ecole_id: id, annee_id: annee.id }} lectureSeule={!peutClasses}
          select="*, maitre:personnel(nom, prenoms), inscriptions(count)"
          titreFormulaire="classe"
          champs={[
            { nom: 'niveau_code', label: 'Niveau', type: 'select', requis: true, options: niveaux.map((n) => ({ value: n.code, label: `${n.code} — ${n.libelle}` })) },
            { nom: 'nom', label: 'Nom de la classe (ex. CM2 A)', requis: true },
            { nom: 'maitre_id', label: 'Maître de la classe', type: 'select', options: (equipe.length ? equipe : personnel).map((p) => ({ value: p.id, label: nomComplet(p) })) },
            { nom: 'multigrade', label: 'Classe multigrade', type: 'checkbox' },
          ]}
          colonnes={[
            { cle: 'nom', label: 'Classe', rendu: (l) => <b>{l.nom}</b> },
            { cle: 'niveau_code', label: 'Niveau' },
            { cle: 'maitre', label: 'Maître', rendu: (l) => nomComplet(l.maitre) },
            { cle: 'eff', label: 'Effectif', rendu: (l) => l.inscriptions?.[0]?.count ?? 0 },
          ]}
        />
      ) : <p className="vide">Activez une année scolaire pour gérer les classes.</p>}

      <h2>Personnel affecté</h2>
      <div className="tableau-cadre">
        <table className="tableau">
          <thead><tr><th>Nom et prénoms</th><th>Matricule</th><th>Emploi</th><th>Fonction</th></tr></thead>
          <tbody>
            {equipe.length === 0 && <tr><td colSpan={4} className="vide">Aucun agent affecté à cette école cette année.</td></tr>}
            {equipe.map((p) => <tr key={p.id}><td>{nomComplet(p)}</td><td>{p.matricule}</td><td>{p.emploi_code}</td><td>{p.fonction_code}</td></tr>)}
          </tbody>
        </table>
      </div>

      {edition && <FormulaireModal titre="Modifier la fiche de l'école" champs={champsEcole(secteurs)} initial={ecole} fermer={() => setEdition(false)} enregistrer={enregistrer} large />}
    </div>
  );
}
