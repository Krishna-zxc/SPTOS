/**
 * App entry point.
 *
 * Provider order matters: `MetaProvider` reads the server's tuning values (the
 * staleness cutoff above all) and every screen below it renders freshness
 * against them, so it has to wrap the router rather than sit inside a page.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { MetaProvider } from './lib/meta.jsx';
import { installRipples } from './lib/ripple.js';
import './index.css';

// Outside React on purpose: press feedback belongs to every button in the app,
// including ones rendered by future screens, and a single document listener
// cannot be forgotten at a call site the way a wrapper component can.
installRipples();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <MetaProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MetaProvider>
    </BrowserRouter>
  </StrictMode>,
);
