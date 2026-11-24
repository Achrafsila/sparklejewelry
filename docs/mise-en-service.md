# Mise en service du back-office Sparkle

Ce guide branche le back-office sur Supabase (base, connexion, photos) puis le publie sur Vercel. Comptez environ 20 minutes.

## 1. Créer le projet Supabase

1. Sur [supabase.com](https://supabase.com), créez un projet (région **Europe**, par exemple Frankfurt ou Paris). Notez le mot de passe de la base dans votre gestionnaire de mots de passe.
2. **Authentication → Sign In / Providers → Email** : laissez la connexion par e-mail active.
3. **Authentication → Sign In / Providers → User Signups** : **désactivez** « Allow new users to sign up ». Seul votre compte doit exister.

## 2. Créer les tables et les règles

Dans **SQL Editor**, exécutez les fichiers de `supabase/migrations/` **dans l’ordre** (copier, coller, *Run*) :

```
0001_schema.sql
0002_core.sql
0003_stock.sql
0004_orders.sql
0005_fulfilment.sql
0006_views.sql
0007_insights.sql
0008_rls.sql
0009_storage.sql
0010_offers.sql
```

Chaque fichier doit se terminer par « Success ». `0009_storage.sql` crée le dossier de photos `photos` (lecture publique, écriture réservée au compte administrateur).

> Avec la CLI Supabase, c’est équivalent : `supabase link` puis `supabase db push`.

## 3. Créer le compte administrateur

1. **Authentication → Users → Add user → Create new user** : votre e-mail et un mot de passe fort (cochez « Auto Confirm User »).
2. Copiez l’**UID** de l’utilisateur créé.
3. Dans **SQL Editor** :

```sql
insert into public.admins (user_id) values ('COLLEZ-ICI-L-UID');
```

Sans cette ligne, la connexion fonctionne mais le back-office reste vide : c’est la règle de sécurité qui protège les données.

## 4. Renseigner les clés publiques

Dans **Project Settings → API**, copiez :

- **Project URL** → `VITE_SUPABASE_URL`
- **anon public key** (ou *publishable key*) → `VITE_SUPABASE_ANON_KEY`

Ces deux valeurs sont publiques par conception : la sécurité repose sur les règles RLS et les fonctions de la base. **Ne mettez jamais la clé `service_role` dans le back-office.**

Pour tester en local contre ce projet, créez `.env.production.local` (non versionné) avec ces deux lignes, puis `npm run build && npm run preview`.

## 5. Publier sur Vercel

1. Importez le dépôt GitHub `sparklejewelry` dans Vercel (Framework : **Vite**, la configuration est dans `vercel.json`).
2. **Settings → Environment Variables** : ajoutez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (Production et Preview).
3. Déployez. Toutes les adresses (`/stock`, `/commandes/…`) renvoient vers l’application.
4. Dans Supabase, **Authentication → URL Configuration** : mettez l’adresse Vercel dans *Site URL* (utile pour le lien « Mot de passe oublié »).

## 6. Premiers réglages

Dans le back-office, **Réglages** :

- seuil d’alerte (5 par défaut) ;
- coût d’emballage par colis ;
- frais de livraison facturés par défaut ;
- transporteurs (ils s’ajoutent aussi automatiquement à la première expédition).

Puis **Stock → Nouvel arrivage** pour enregistrer le premier arrivage.

## 7. Vérifications sur votre téléphone

Ces points n’ont pas pu être vérifiés sur un vrai iPhone pendant le développement (simulation WebKit uniquement) :

- en mode sombre, le texte saisi reste foncé sur fond clair, y compris après l’autoremplissage ;
- « Prendre une photo » ouvre l’appareil photo et la photo s’envoie avec sa barre de progression ;
- la barre du bas et la barre d’actions ne masquent rien (zone de sécurité de l’iPhone).

## Développement local (sans Supabase en ligne)

Prérequis : Node 22+, PostgreSQL 17 et PostgREST via Homebrew (`brew install postgresql@17 postgrest`).

```bash
npm install
npm run db:start      # Postgres (port 54329) + PostgREST (port 54331)
npm run db:reset      # base vide + compte de test (dev/users.json)
npm run dev           # http://localhost:5173
```

Les données locales (base de test, photos de test, journaux) sont rangées **hors du projet**, dans `~/Library/Application Support/sparkle-backoffice` (modifiable avec `SPARKLE_LOCAL_DIR`) : le projet peut se trouver dans un dossier synchronisé (Bureau iCloud) qui ne doit pas contenir une base en cours d’écriture.

Tests :

```bash
npm run test:unit     # règles de saisie (montants, téléphone, références…)
npm run test:db       # règles métier dans la base, concurrence comprise
npm run test:e2e      # parcours réels : téléphone, tablette, ordinateur, WebKit en mode sombre
```
