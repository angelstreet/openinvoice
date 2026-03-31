import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { ClerkAuthProvider, NoAuthProvider, TeamsAuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const teamParam = new URLSearchParams(window.location.search).get('team');

const router = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {teamParam ? (
      <TeamsAuthProvider team={teamParam}>
        {router}
      </TeamsAuthProvider>
    ) : clerkPubKey ? (
      <ClerkProvider publishableKey={clerkPubKey}>
        <ClerkAuthProvider>
          {router}
        </ClerkAuthProvider>
      </ClerkProvider>
    ) : (
      <NoAuthProvider>
        {router}
      </NoAuthProvider>
    )}
  </StrictMode>,
);
