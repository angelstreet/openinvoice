import { Navigate } from 'react-router-dom';
import { useAppAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import type { Lang } from '../i18n';

interface ProtectedRouteProps {
  children: React.ReactNode;
  lang: Lang;
}

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const isTeamsContext = new URLSearchParams(window.location.search).has('team');

export default function ProtectedRoute({ children, lang }: ProtectedRouteProps) {
  const { isLoaded, isSignedIn } = useAppAuth();

  // If no auth provider is active, redirect to demo page
  if (!clerkPubKey && !isTeamsContext) {
    return <Navigate to="/" replace />;
  }

  // Loading state
  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  // Not signed in
  if (!isSignedIn) {
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <svg
            className="mx-auto h-12 w-12 text-slate-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">
            {t(lang, 'authRequired')}
          </h2>
          <p className="text-sm text-slate-500">
            {t(lang, 'signInToAccess')}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
