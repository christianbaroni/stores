import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createContext } from '../shared/identity';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Unable to find root element');

const root = createRoot(container);
const context = createContext('options', 'Options');

root.render(
  <StrictMode>
    <App context={context} />
  </StrictMode>
);
