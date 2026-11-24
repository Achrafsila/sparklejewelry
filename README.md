# Sparkle Jewelry : back-office

Outil quotidien de Sparkle : réceptionner les bijoux, tenir le stock, composer les offres (unité, trio fixe, trio à composer), saisir les commandes Instagram au téléphone, préparer et expédier, suivre chaque colis jusqu’au versement du transporteur ou au retour, et lire la marge.

- **Interface** : Vite + React + TypeScript, servie en fichiers statiques (Vercel).
- **Données** : Supabase (Postgres, connexion, photos). Toutes les opérations qui touchent le stock ou l’argent sont des fonctions Postgres transactionnelles, protégées contre les doublons (`supabase/migrations/`).
- **Future boutique** : même catalogue, même stock, mêmes règles de réservation (`docs/boutique.md`).

## Démarrer

- Mise en ligne (Supabase + Vercel) : [`docs/mise-en-service.md`](docs/mise-en-service.md)
- Développement local : section « Développement local » du même guide.

```bash
npm install
npm run db:start && npm run db:reset
npm run dev
```

## Tests

| Commande | Ce qui est vérifié |
|---|---|
| `npm run test:unit` | montants (« 15,50 »), téléphones marocains, références, brouillons locaux, messages d’erreur |
| `npm run test:db` | règles métier dans Postgres : arrivages et coût moyen, confirmation tout ou rien, concurrence sur la dernière pièce, rejeu, expédition, retours, versements, pilotage, import |
| `npm run test:e2e` | parcours réels sur téléphone (Chromium et WebKit en mode sombre), tablette et ordinateur |

## Organisation

```
src/app/         navigation, connexion, mise en page
src/features/    stock, arrivages, offres, commandes, préparation, suivi, pilotage, réglages, recherche
src/ui/          composants partagés (champs, montants, écrins photo, listes, panneaux)
src/lib/         montants, téléphone, références, brouillons, appels Supabase
supabase/        migrations SQL
dev/             pile locale (Postgres, PostgREST, bouchon Auth/Storage) : développement uniquement
legacy/          ancien prototype HTML, avec son bouton « Exporter (JSON) »
docs/            mise en service, boutique, conception et plan
```
