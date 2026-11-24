import { Link } from 'react-router';

export function Wordmark({ to = '/stock' }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="Sparkle, retour au stock">
      <span className="wordmark__name">Sparkle</span>
      <span className="wordmark__facet" aria-hidden="true" />
    </Link>
  );
}
