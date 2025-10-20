import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createIdentity } from '../shared/identity';
import { ensureExtensionStoresConfigured } from '../shared/setupStores';
import App from './App';

ensureExtensionStoresConfigured();

const container = document.getElementById('root');
if (!container) throw new Error('Unable to find root element');

const root = createRoot(container);
const identity = createIdentity('Popup Console');

root.render(
  <StrictMode>
    <App identity={identity} />
  </StrictMode>
);
