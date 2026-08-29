#!/usr/bin/env node
'use strict';
/*
  admin:reset — redonne la main sur l'espace vendeur.

  Le compte admin est créé au premier lancement seulement : changer
  ADMIN1_PASSWORD dans Render ne remplace PAS le mot de passe d'un compte qui
  existe déjà. Ce script fait ce que le démarreur n'ose pas faire : il remet
  à plat l'identifiant et le mot de passe, sur la base que le service utilise.

  Usage (Shell Render, ou terminal à la racine du projet) :

      ADMIN1_PASSWORD='un mot de passe solide' npm run admin:reset
      npm run admin:reset -- --user=fatou --pass='un mot de passe solide'
      npm run admin:reset -- --user=fatou --genere        # un mot de passe est inventé et affiché une fois
      npm run admin:reset -- --aide

  Sans DATA_DIR explicite, on utilise celui du serveur : la commande touche donc
  la vraie base du service. Sur Render, le Shell du service voit déjà DATA_DIR.
*/

const DONNEES = {
  'sans mot de passe': 'Rien n’a été changé : le mot de passe doit venir de ADMIN1_PASSWORD, de --pass=…, ou de --genere.',
  'base introuvable': 'La base du service est injoignable — vérifie DATA_DIR (sur Render, lancer depuis le Shell du service).',
};

function aide() {
  console.log([
    'admin:reset — remettre à plat l’accès à l’espace vendeur',
    '',
    '  --user=<identifiant>   l’identifiant de connexion (défaut : ADMIN1_USERNAME, sinon « admin »)',
    '  --pass=<mot de passe>  le nouveau mot de passe (au moins 10 caractères)',
    '  --genere               invente un mot de passe solide et l’affiche une seule fois',
    '  --aide                 cette page',
    '',
    'Rien n’est écrit sans mot de passe. Le mot de passe n’est jamais réaffiché ensuite :',
    'note-le, puis change-le dans l’espace vendeur si tu le veux.',
  ].join('\n'));
}

/* les arguments passent après `--` avec npm : `npm run admin:reset -- --user=x` */
function lireArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

/* même règle que le serveur pour l'inventaire des comptes : pas de devinette */
function motDePasseFort(p) {
  return typeof p === 'string' && p.length >= 10;
}

function generer() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const { randomBytes } = require('crypto');
  const tirage = randomBytes(16);
  let s = '';
  for (let i = 0; i < tirage.length; i++) s += alphabet[tirage[i] % alphabet.length];
  /* un chiffre et un signe pour passer les règles des gestionnaires de mots de passe */
  return s.slice(0, 12) + '-' + String(10 + (tirage[14] % 89)) + '!';
}

function principal() {
  const args = lireArgs(process.argv);
  if (args.aide || args.help) return aide();

  const user = String(args.user || process.env.ADMIN1_USERNAME || 'admin').trim().toLowerCase();
  const passe = args.pass ? String(args.pass) : process.env.ADMIN1_PASSWORD ? String(process.env.ADMIN1_PASSWORD) : (args.genere ? generer() : null);

  if (!passe) {
    console.error('✗ ' + DONNEES['sans mot de passe']);
    console.error('  Sur Render : lancer la commande depuis le Shell du service, pour qu’il voie la même base que la boutique.');
    return 2;
  }
  if (!motDePasseFort(passe)) {
    console.error('✗ Mot de passe trop court : 10 caractères minimum.');
    return 2;
  }

  let db, hashPassword;
  try {
    ({ db } = require('../server/db'));
    ({ hashPassword } = require('../server/security'));
  } catch (e) {
    console.error('✗ ' + DONNEES['base introuvable'] + ' (' + String(e.message || e).slice(0, 90) + ')');
    return 3;
  }

  const hash = hashPassword(passe);
  const existant = db.prepare('SELECT id, username FROM admins WHERE username = ?').get(user);
  if (existant) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existant.id);
    console.log('✔ Mot de passe remplacé pour « ' + user + ' » (compte n° ' + existant.id + ').');
  } else {
    const nom = String(args.nom || process.env.ADMIN1_NOM || 'La boutique').trim();
    db.prepare('INSERT INTO admins (username, password_hash, display_name) VALUES (?,?,?)').run(user, hash, nom);
    console.log('✔ Compte « ' + user + ' » créé (il n’existait pas sur cette base).');
  }
  console.log('   Connexion : /admin — la session dure 12 heures.');
  if (args.genere) console.log('   Mot de passe (une seule fois, note-le) : ' + passe);
  return 0;
}

process.exitCode = principal();
