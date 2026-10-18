import '@asistente/ui/tokens.css';
import '@asistente/ui/guiame.css';
import './site-check.css';
import './popover.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteCheckPopover } from './SiteCheck';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteCheckPopover />
  </StrictMode>,
);
