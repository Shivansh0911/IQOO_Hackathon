/** Standalone entry, so Tiffin can be developed and judged on its own merits. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TiffinApp } from './TiffinApp.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('Tiffin: #root is missing from index.html');

createRoot(host).render(
  <StrictMode>
    <TiffinApp />
  </StrictMode>,
);
