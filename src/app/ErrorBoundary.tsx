import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps a broken screen from taking the whole back-office down. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Écran en erreur', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <p className="empty__title">Cet écran n’a pas pu s’afficher.</p>
        <p className="empty__text">Vos données ne sont pas perdues. Rechargez la page pour réessayer.</p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          Recharger la page
        </button>
      </div>
    );
  }
}
