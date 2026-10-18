import '@asistente/ui/tokens.css';
import '@asistente/ui/guiame.css';
import './card.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpCard } from './HelpCard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelpCard />
  </StrictMode>,
);
