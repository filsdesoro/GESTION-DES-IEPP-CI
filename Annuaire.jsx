import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from './contexte.jsx';
import { supabase, traduireErreur } from './supabase';
import { libelle } from './Formulaire.jsx';
import { nomComplet, useEcoles, useListe } from './Choix.jsx';
import { signalerSuppression } from './Corbeille.jsx';

const FONCTIONS_DIRECTEUR = ['DIR_DECH', 'DIR_CLASSE'];
const VUES = [['secteurs', 'Écoles par secteur'], ['classes', 'Classes par école'], ['enseignants', 'Enseignants']];

/** Lit toutes les lignes d'une requête (Supabase renvoie 1000 lignes au plus par appel). */
async function toutLire(fabrique) {
  const tout = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await fabrique().range(debut, debut + 999);
    if (error) throw error;
    tout.push(...(data || []));
    if (!data || data.length < 1000) return tout;
  }
}

const somme = (lignes) => lignes.reduce((t, l) => ({
  classes: t.classes + (l.classes || 0), garcons: t.garcons + l.garcons, filles: t.filles + l.filles, effectif: t.effectif + l.effectif,
}), { classes: 0, garcons: 0, filles: 0, effectif: 0 });

export default function Annuaire() {
  const { ieppId, iepp, annee, role, version } = useApp();
  const [recharge, setRecharge] = useState(0);
  // Qui peut supprimer quoi
  const peutEcole = ['superviseur', 'iepp'].includes(role);
  const peutClasse = ['superviseur', 'iepp', 'directeur', 'saisie'].includes(role);
  const peutAgent = ['superviseur', 'iepp', 'conseiller'].includes(role);

  async function supprimerEcole(l) {
    if (!confirm(`Supprimer l'école « ${l.ecole.nom} » ?\n\nSes ${l.classes} classe(s) et ${l.effectif} élève(s) inscrits seront aussi supprimés.\n(Vous pourrez annuler, ou la restaurer depuis la Corbeille.)`)) return;
    const { error } = await supabase.from('ecoles').delete().eq('id', l.ecole.id);
    if (error) return alert(traduireErreur(error));
    signalerSuppression(l.ecole.nom);
    setRecharge((n) => n + 1);
  }
  async function supprimerClasse(c, ecole) {
    if (!confirm(`Supprimer la classe « ${c.nom} » de ${ecole.nom} ?\n\nSes ${c.effectif} élève(s) inscrits et leurs notes seront aussi supprimés.\n(Vous pourrez annuler, ou la restaurer depuis la Corbeille.)`)) return;
    const { error } = await supabase.from('classes').delete().eq('id', c.id);
    if (error) return alert(traduireErreur(error));
    signalerSuppression(`${c.nom} — ${ecole.nom}`);
    setRecharge((n) => n + 1);
  }
  async function supprimerAgent(a) {
    if (!confirm(`Supprimer ${nomComplet(a.personnel)} du personnel de ${annee.libelle} ?\n(Sa fiche est effacée sauf s'il a un compte ou une autre affectation.)\n\nVous pourrez annuler, ou le restaurer depuis la Corbeille.`)) return;
    let { error } = await supabase.rpc('supprimer_agent', { p_affectation: a.id });
    if (error && /function|schema cache/i.test(error.message)) ({ error } = await supabase.from('affectations').delete().eq('id', a.id));
    if (error) return alert(traduireErreur(error));
    signalerSuppression(nomComplet(a.personnel));
    setRecharge((n) => n + 1);
  }
  const ecolesVisibles = useEcoles();
  const secteurs = useListe('secteurs', { filtre: { iepp_id: ieppId }, ordre: 'nom' });
  const emplois = useListe('emplois');
  const [vue, setVue] = useState('secteurs');
  const [secteurId, setSecteurId] = useState('');
  const [ecoleId, setEcoleId] = useState('');
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');

  // Chargement : écoles (détail), classes, effectifs, personnel de l'année active
  useEffect(() => {
    if (!ieppId || !annee) return;
    let annule = false;
    setDonnees(null); setErreur('');
    (async () => {
      try {
        const [ecoles, classes, inscriptions, affectations] = await Promise.all([
          toutLire(() => supabase.from('ecoles').select('id, nom, code_ecole, secteur_id, statut, localite, telephone').eq('iepp_id', ieppId).order('nom')),
          toutLire(() => supabase.from('classes').select('id, nom, niveau_code, ecole_id, maitre_id, multigrade, ecoles!inner(iepp_id)')
            .eq('annee_id', annee.id).eq('ecoles.iepp_id', ieppId).order('nom')),
          toutLire(() => supabase.from('inscriptions').select('id, classe_id, eleves(sexe), classes!inner(ecoles!inner(iepp_id))')
            .eq('annee_id', annee.id).eq('classes.ecoles.iepp_id', ieppId).order('id')),
          toutLire(() => supabase.from('affectations').select('id, ecole_id, fonction_code, personnel(*), fonctions(libelle)')
            .eq('iepp_id', ieppId).eq('annee_id', annee.id).order('id')),
        ]);
        if (!annule) setDonnees({ ecoles, classes, inscriptions, affectations });
      } catch (e) {
        if (!annule) setErreur(traduireErreur(e));
      }
    })();
    return () => { annule = true; };
  }, [ieppId, annee, recharge, version]);

  // Le directeur / l'agent de saisie / le conseiller ne voient que leurs écoles
  const idsVisibles = useMemo(() => new Set(ecolesVisibles.map((e) => e.id)), [ecolesVisibles]);
  const ecolesFiltrables = (donnees?.ecoles || []).filter((e) => idsVisibles.has(e.id));
  const ecolesDuSecteur = ecolesFiltrables.filter((e) => !secteurId || (secteurId === 'aucun' ? !e.secteur_id : e.secteur_id === secteurId));
  const ecolesRetenues = ecolesDuSecteur.filter((e) => !ecoleId || e.id === ecoleId);
  useEffect(() => { if (ecoleId && !ecolesDuSecteur.some((e) => e.id === ecoleId)) setEcoleId(''); }, [secteurId]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcul = useMemo(() => {
    if (!donnees) return null;
    const effClasse = {};
    donnees.inscriptions.forEach((i) => {
      const c = effClasse[i.classe_id] || (effClasse[i.classe_id] = { garcons: 0, filles: 0, effectif: 0 });
      if (i.eleves?.sexe === 'M') c.garcons += 1;
      if (i.eleves?.sexe === 'F') c.filles += 1;
      c.effectif += 1;
    });
    const personnelParId = {};
    donnees.affectations.forEach((a) => { if (a.personnel) personnelParId[a.personnel.id] = a.personnel; });
    const classes = donnees.classes.map((c) => ({
      ...c, ...(effClasse[c.id] || { garcons: 0, filles: 0, effectif: 0 }), maitre: personnelParId[c.maitre_id] || null,
    }));
    const classesParEcole = {};
    classes.forEach((c) => (classesParEcole[c.ecole_id] ||= []).push(c));
    const directeurs = {};
    donnees.affectations.forEach((a) => {
      if (a.ecole_id && FONCTIONS_DIRECTEUR.includes(a.fonction_code) && !directeurs[a.ecole_id]) directeurs[a.ecole_id] = a.personnel;
    });
    const classeTenue = {};
    classes.forEach((c) => { if (c.maitre_id) (classeTenue[c.maitre_id] ||= []).push(c.nom); });
    const ligneEcole = (e) => {
      const cl = classesParEcole[e.id] || [];
      return { ecole: e, directeur: directeurs[e.id] || null, ...somme(cl), classes: cl.length, classes_detail: cl.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true })) };
    };
    return { ligneEcole, classeTenue };
  }, [donnees]);

  const nomSecteur = (id) => secteurs.find((s) => s.id === id)?.nom || 'Sans secteur';
  const titreSecteur = (nom) => (/^(secteur|sans secteur)/i.test(nom) ? nom : `Secteur pédagogique ${nom}`);
  const emploi = (code) => emplois.find((x) => x.code === code)?.libelle || code || '';

  // ----- Vue 1 : écoles par secteur -----
  const groupesSecteur = useMemo(() => {
    if (!calcul) return [];
    const g = {};
    ecolesRetenues.forEach((e) => (g[e.secteur_id || 'aucun'] ||= []).push(calcul.ligneEcole(e)));
    return Object.entries(g)
      .map(([id, lignes]) => ({ id, nom: id === 'aucun' ? 'Sans secteur' : nomSecteur(id), lignes, total: somme(lignes) }))
      .sort((a, b) => (a.id === 'aucun') - (b.id === 'aucun') || a.nom.localeCompare(b.nom, 'fr'));
  }, [calcul, ecolesRetenues, secteurs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Vue 2 : classes par école -----
  const lignesEcoles = useMemo(() => (calcul ? ecolesRetenues.map(calcul.ligneEcole) : []), [calcul, ecolesRetenues]);

  // ----- Vue 3 : enseignants par école -----
  const groupesEnseignants = useMemo(() => {
    if (!donnees || !calcul) return [];
    const retenues = new Set(ecolesRetenues.map((e) => e.id));
    const g = {};
    donnees.affectations.forEach((a) => {
      if (!a.personnel) return;
      if (a.ecole_id ? !retenues.has(a.ecole_id) : (secteurId || ecoleId || !['superviseur', 'iepp'].includes(role))) return;
      (g[a.ecole_id || 'bureau'] ||= []).push(a);
    });
    const ordre = (a, b) => (FONCTIONS_DIRECTEUR.includes(b.fonction_code) - FONCTIONS_DIRECTEUR.includes(a.fonction_code))
      || nomComplet(a.personnel).localeCompare(nomComplet(b.personnel), 'fr');
    const groupes = ecolesRetenues.filter((e) => g[e.id]).map((e) => ({ id: e.id, nom: e.nom, lignes: g[e.id].sort(ordre) }));
    if (g.bureau) groupes.unshift({ id: 'bureau', nom: `Bureau de l'inspection${iepp ? ` (${iepp.nom})` : ''}`, lignes: g.bureau.sort(ordre) });
    return groupes;
  }, [donnees, calcul, ecolesRetenues, secteurId, ecoleId, role, iepp]);

  // ----- Export -----
  function lignesExport() {
    if (vue === 'secteurs') {
      return groupesSecteur.flatMap((g) => [
        ...g.lignes.map((l) => ({
          Secteur: g.nom, École: l.ecole.nom, Code: l.ecole.code_ecole || '', Statut: libelle('statut_ecole', l.ecole.statut),
          Localité: l.ecole.localite || '', Directeur: nomComplet(l.directeur), 'Contact directeur': l.directeur?.telephone || l.ecole.telephone || '',
          Classes: l.classes, Garçons: l.garcons, Filles: l.filles, Effectif: l.effectif,
        })),
        { Secteur: g.nom, École: 'Total du secteur', Classes: g.total.classes, Garçons: g.total.garcons, Filles: g.total.filles, Effectif: g.total.effectif },
      ]);
    }
    if (vue === 'classes') {
      return lignesEcoles.flatMap((l) => [
        ...l.classes_detail.map((c) => ({
          École: l.ecole.nom, Classe: c.nom, Niveau: c.niveau_code, Multigrade: c.multigrade ? 'Oui' : '',
          Maître: nomComplet(c.maitre), Garçons: c.garcons, Filles: c.filles, Effectif: c.effectif,
        })),
        { École: l.ecole.nom, Classe: "Total de l'école", Garçons: l.garcons, Filles: l.filles, Effectif: l.effectif },
      ]);
    }
    return groupesEnseignants.flatMap((g) => g.lignes.map((a, i) => ({
      'Affectation': g.nom, 'N°': i + 1, 'Nom et prénoms': nomComplet(a.personnel), Matricule: a.personnel.matricule || '',
      Sexe: a.personnel.sexe || '', 'Emploi': emploi(a.personnel.emploi_code), Fonction: a.fonctions?.libelle || '',
      'Classe tenue': (calcul.classeTenue[a.personnel.id] || []).join(', '), Téléphone: a.personnel.telephone || '',
    })));
  }
  function exporter(format) {
    const ws = XLSX.utils.json_to_sheet(lignesExport());
    const nom = `annuaire_${vue}_${(iepp?.nom || 'iepp').replace(/[^\w-]+/g, '_')}_${annee?.libelle || ''}`;
    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      lien.download = `${nom}.csv`;
      lien.click();
      URL.revokeObjectURL(lien.href);
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, VUES.find((v) => v[0] === vue)[1].slice(0, 31));
    XLSX.writeFile(wb, `${nom}.xlsx`);
  }

  const vide = donnees && !ecolesRetenues.length;
  const titreVue = VUES.find((v) => v[0] === vue)[1];

  return (
    <div className="annuaire">
      <h1>Annuaire des écoles</h1>
      <p className="sous-titre">Inspection : <strong className="rouge">{iepp?.nom || '—'}</strong>{annee ? ` — année scolaire ${annee.libelle}` : ''}</p>
      <p className="imprime-seul titre-impression">{titreVue}</p>

      <div className="barre-outils annuaire-outils">
        <select value={secteurId} onChange={(e) => setSecteurId(e.target.value)} aria-label="Secteur pédagogique">
          <option value="">Tous les secteurs</option>
          {secteurs.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          {ecolesFiltrables.some((e) => !e.secteur_id) && <option value="aucun">Sans secteur</option>}
        </select>
        <select value={ecoleId} onChange={(e) => setEcoleId(e.target.value)} aria-label="École">
          <option value="">Toutes les écoles</option>
          {ecolesDuSecteur.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <div className="bascule">
          {VUES.map(([k, l]) => <button key={k} className={vue === k ? 'actif' : ''} onClick={() => setVue(k)}>{l}</button>)}
        </div>
      </div>
      <div className="barre-outils">
        <button className="btn-contour" disabled={!donnees} onClick={() => exporter('xlsx')}>Exporter Excel</button>
        <button className="btn-contour" disabled={!donnees} onClick={() => exporter('csv')}>Exporter CSV</button>
        <button className="btn-contour" disabled={!donnees} onClick={() => window.print()}>Imprimer</button>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {!donnees && !erreur && <p className="discret">Chargement…</p>}
      {vide && <p className="vide">Aucune école pour ce choix.</p>}

      {vue === 'secteurs' && groupesSecteur.map((g) => (
        <section key={g.id} className="carte bloc-annuaire">
          <h2>{titreSecteur(g.nom)} — {g.lignes.length} école{g.lignes.length > 1 ? 's' : ''}</h2>
          <div className="tableau-cadre"><table className="tableau">
            <thead><tr><th>École</th><th>Statut</th><th>Directeur</th><th>Contact</th><th className="nombre">Classes</th><th className="nombre">Garçons</th><th className="nombre">Filles</th><th className="nombre">Effectif</th>{peutEcole && <th className="non-imprime"></th>}</tr></thead>
            <tbody>
              {g.lignes.map((l) => (
                <tr key={l.ecole.id}>
                  <td><strong>{l.ecole.nom}</strong>{l.ecole.code_ecole && <div className="discret">{l.ecole.code_ecole}</div>}</td>
                  <td>{libelle('statut_ecole', l.ecole.statut)}</td>
                  <td>{nomComplet(l.directeur) || '—'}</td>
                  <td>{l.directeur?.telephone || l.ecole.telephone || '—'}</td>
                  <td className="nombre">{l.classes}</td><td className="nombre">{l.garcons}</td><td className="nombre">{l.filles}</td><td className="nombre">{l.effectif}</td>
                  {peutEcole && <td className="actions-ligne non-imprime"><button className="lien danger" onClick={() => supprimerEcole(l)}>Supprimer</button></td>}
                </tr>
              ))}
              <tr className="ligne-total"><td colSpan={4}>Total du secteur</td><td className="nombre">{g.total.classes}</td><td className="nombre">{g.total.garcons}</td><td className="nombre">{g.total.filles}</td><td className="nombre">{g.total.effectif}</td>{peutEcole && <td className="non-imprime"></td>}</tr>
            </tbody>
          </table></div>
        </section>
      ))}
      {vue === 'secteurs' && groupesSecteur.length > 1 && (() => {
        const t = somme(groupesSecteur.map((g) => g.total));
        const nb = groupesSecteur.reduce((n, g) => n + g.lignes.length, 0);
        return (
          <div className="carte total-general">
            <strong>Total de la circonscription</strong>
            <span>{nb} écoles</span><span>{t.classes} classes</span><span>{t.garcons} garçons</span><span>{t.filles} filles</span><span><strong>{t.effectif} élèves</strong></span>
          </div>
        );
      })()}

      {vue === 'classes' && lignesEcoles.map((l) => (
        <section key={l.ecole.id} className="carte bloc-annuaire">
          <h2>{l.ecole.nom} — {l.classes} classe{l.classes > 1 ? 's' : ''}
            {peutEcole && <button className="lien danger non-imprime titre-action" onClick={() => supprimerEcole(l)}>Supprimer l'école</button>}</h2>
          <p className="discret">{nomSecteur(l.ecole.secteur_id)} · Directeur : {nomComplet(l.directeur) || '—'}</p>
          {l.classes_detail.length ? (
            <div className="tableau-cadre"><table className="tableau">
              <thead><tr><th>Classe</th><th>Niveau</th><th>Maître</th><th className="nombre">Garçons</th><th className="nombre">Filles</th><th className="nombre">Effectif</th>{peutClasse && <th className="non-imprime"></th>}</tr></thead>
              <tbody>
                {l.classes_detail.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.nom}</strong>{c.multigrade && <span className="badge">multigrade</span>}</td>
                    <td>{c.niveau_code}</td><td>{nomComplet(c.maitre) || '—'}</td>
                    <td className="nombre">{c.garcons}</td><td className="nombre">{c.filles}</td><td className="nombre">{c.effectif}</td>
                    {peutClasse && <td className="actions-ligne non-imprime"><button className="lien danger" onClick={() => supprimerClasse(c, l.ecole)}>Supprimer</button></td>}
                  </tr>
                ))}
                <tr className="ligne-total"><td colSpan={3}>Total de l'école</td><td className="nombre">{l.garcons}</td><td className="nombre">{l.filles}</td><td className="nombre">{l.effectif}</td>{peutClasse && <td className="non-imprime"></td>}</tr>
              </tbody>
            </table></div>
          ) : <p className="vide">Aucune classe enregistrée pour cette année.</p>}
        </section>
      ))}

      {vue === 'enseignants' && donnees && !groupesEnseignants.length && !vide && <p className="vide">Aucun personnel affecté pour ce choix.</p>}
      {vue === 'enseignants' && groupesEnseignants.map((g) => (
        <section key={g.id} className="carte bloc-annuaire">
          <h2>{g.nom} — {g.lignes.length} agent{g.lignes.length > 1 ? 's' : ''}</h2>
          <div className="tableau-cadre"><table className="tableau">
            <thead><tr><th>N°</th><th>Nom et prénoms</th><th>Matricule</th><th>Sexe</th><th>Emploi</th><th>Fonction</th><th>Classe tenue</th><th>Téléphone</th>{peutAgent && <th className="non-imprime"></th>}</tr></thead>
            <tbody>
              {g.lignes.map((a, i) => (
                <tr key={a.id}>
                  <td>{i + 1}</td><td><strong>{nomComplet(a.personnel)}</strong></td><td>{a.personnel.matricule || '—'}</td>
                  <td>{a.personnel.sexe || '—'}</td><td>{emploi(a.personnel.emploi_code) || '—'}</td><td>{a.fonctions?.libelle || '—'}</td>
                  <td>{(calcul.classeTenue[a.personnel.id] || []).join(', ') || '—'}</td><td>{a.personnel.telephone || '—'}</td>
                  {peutAgent && <td className="actions-ligne non-imprime"><button className="lien danger" onClick={() => supprimerAgent(a)}>Supprimer</button></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      ))}
    </div>
  );
}
