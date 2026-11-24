import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { SWRConfig } from 'swr';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-serif/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/glass.css';
import './styles/forms.css';
import './styles/components.css';
import './styles/layout.css';
import { AuthProvider } from './app/auth';
import { router } from './app/router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SWRConfig value={{ revalidateOnFocus: true, keepPreviousData: true, errorRetryCount: 2 }}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </SWRConfig>
  </StrictMode>,
);
