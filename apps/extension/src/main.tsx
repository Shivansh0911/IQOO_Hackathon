import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel.js';
import './panel.css';

const host = document.getElementById('root');
if (!host) throw new Error('Origo panel: #root missing');
createRoot(host).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
