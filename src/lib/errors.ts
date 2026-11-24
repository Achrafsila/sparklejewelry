export class AppError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, details: unknown = null) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

function parseDetails(details: unknown): unknown {
  if (typeof details !== 'string' || details === '') return details ?? null;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

/** Turns a PostgREST error, a network failure or anything thrown into an AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof TypeError) return new AppError('RESEAU');
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as { message: string; details?: unknown; code?: string };
    if (e.code === 'P0001' || /^[A-Z_]+$/.test(e.message)) return new AppError(e.message, parseDetails(e.details));
    if (e.code === '42501' || e.code === 'PGRST301' || e.code === 'PGRST303') return new AppError('NON_AUTORISE');
    if (/fetch|network/i.test(e.message)) return new AppError('RESEAU');
    return new AppError('INCONNUE', e.message);
  }
  return new AppError('INCONNUE', String(error));
}

const trioReasons: Record<string, string> = {
  count: 'Choisissez exactement trois pièces.',
  non_eligible: 'Une pièce choisie ne fait pas partie de ce trio.',
  repeat: 'Ce trio n’autorise pas deux fois la même pièce.',
};

export function messageFor(error: AppError): string {
  const d = error.details as Record<string, unknown> | unknown[] | null;
  switch (error.code) {
    case 'NON_AUTORISE':
      return 'Session expirée ou accès refusé. Reconnectez-vous.';
    case 'RESEAU':
      return 'Connexion impossible. Vérifiez le réseau puis réessayez.';
    case 'VALEUR_INVALIDE':
      return 'Vérifiez le champ indiqué.';
    case 'SKU_EXISTE':
      return 'Cette référence existe déjà.';
    case 'MODELE_VARIANTE_EXISTE':
      return 'Ce modèle et cette variante existent déjà. Utilisez « Modèle existant » pour un réassort.';
    case 'STOCK_INSUFFISANT': {
      const n = Array.isArray(d) ? d.length : 1;
      return `Stock insuffisant pour ${n} référence${n > 1 ? 's' : ''}.`;
    }
    case 'ETAT_INVALIDE':
      return 'Cette commande a déjà changé d’état. Rechargez la fiche.';
    case 'PANIER_VIDE':
      return 'Ajoutez au moins une offre.';
    case 'OFFRE_INVALIDE':
      return 'Cette offre n’est plus disponible, ou une variante doit être choisie.';
    case 'TRIO_INVALIDE': {
      const reason = d && !Array.isArray(d) ? String(d.reason ?? '') : '';
      return trioReasons[reason] ?? 'Composition du trio invalide.';
    }
    case 'COMMANDE_DEJA_RATTACHEE': {
      const number = d && !Array.isArray(d) && d.number ? ` ${String(d.number)}` : '';
      return `La commande${number} est déjà rattachée à un autre versement.`;
    }
    case 'RETOUR_INCOHERENT':
      return 'Le nombre de pièces abîmées dépasse le nombre de pièces expédiées.';
    case 'IMPORT_CONFLIT':
      return 'Certaines références existent déjà. Rien n’a été importé.';
    case 'PHOTO_ILLISIBLE':
      return 'Photo illisible. Essayez une photo JPEG ou PNG.';
    case 'PHOTO_ENVOI':
      return 'L’envoi de la photo a échoué. Réessayez.';
    default:
      return 'Une erreur est survenue. Réessayez.';
  }
}

/** Field named by a VALEUR_INVALIDE error, if any. */
export function invalidField(error: AppError | null): string | null {
  if (!error || error.code !== 'VALEUR_INVALIDE') return null;
  const d = error.details as { field?: string } | null;
  return d?.field ?? null;
}
