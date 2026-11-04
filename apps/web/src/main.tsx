import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/fonts.ts';
import './styles/tokens/primitives.css';
import './styles/tokens/roles.css';
import './styles/base.css';
import './styles/components.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
