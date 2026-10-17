import '@asistente/ui/tokens.css';
import '@asistente/ui/mostrame.css';
import './card.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelpCard } from './HelpCard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelpCard />
  </StrictMode>,
);
