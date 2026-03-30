import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useAppAuth } from './contexts/AuthContext';
import AuthButton from './components/AuthButton';
import BottomNav from './components/BottomNav';
import ProtectedRoute from './components/ProtectedRoute';
import DemoPage from './pages/DemoPage';
import HistoryPage from './pages/HistoryPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import DashboardPage from './pages/DashboardPage';
import { t } from './i18n';
import type { Lang } from './i18n';

const clerkConfigured = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function App() {
  const [lang, setLang] = useState<Lang>('fr');
  const { isSignedIn } = useAppAuth();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
      isActive
        ? 'bg-slate-800 text-white'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1 flex items-center relative">
          {/* Left: logo + title */}
          <div className="flex items-center gap-2 sm:gap-4">
            <img src="/logo.png" alt="OpenInvoice" className="h-14 w-14" />
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-slate-900">{t(lang, 'title')}</h1>
              <p className="mt-0.5 text-sm text-slate-500 hidden sm:block">
                {t(lang, 'subtitle')}
              </p>
            </div>
          </div>

          {/* Center: navigation (absolutely centered, won't shift) */}
          {clerkConfigured && isSignedIn && (
            <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
              <NavLink to="/" end className={navLinkClass}>
                {t(lang, 'navExtract')}
              </NavLink>
              <NavLink to="/history" className={navLinkClass}>
                {t(lang, 'navHistory')}
              </NavLink>
              <NavLink to="/dashboard" className={navLinkClass}>
                {t(lang, 'navDashboard')}
              </NavLink>
            </nav>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right: language toggle + auth/profile */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language toggle */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setLang('en')}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  lang === 'en'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('fr')}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  lang === 'fr'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                FR
              </button>
            </div>

            {/* Auth button / profile (far right) */}
            <AuthButton lang={lang} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 sm:py-3 w-full pb-16 md:pb-3">
        <Routes>
          <Route path="/" element={<DemoPage lang={lang} />} />
          <Route
            path="/history"
            element={
              <ProtectedRoute lang={lang}>
                <HistoryPage lang={lang} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history/:id"
            element={
              <ProtectedRoute lang={lang}>
                <DocumentDetailPage lang={lang} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute lang={lang}>
                <DashboardPage lang={lang} />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-6xl font-bold text-slate-300">404</p>
              <p className="mt-2 text-slate-500">{lang === 'fr' ? 'Page introuvable' : 'Page not found'}</p>
              <a href="/" className="mt-4 text-sm text-slate-600 hover:text-slate-900 underline">
                {lang === 'fr' ? 'Retour à l\'accueil' : 'Back to home'}
              </a>
            </div>
          } />
        </Routes>
      </main>

      {/* Footer — hidden on mobile only when bottom nav is visible */}
      <footer className={`border-t border-slate-200 mt-auto ${clerkConfigured && isSignedIn ? 'hidden md:block' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-center gap-3 text-xs text-slate-400">
          <span>{t(lang, 'footerText')}</span>
          <span className="px-2 py-0.5 bg-orange-400 text-white font-bold rounded text-[10px] uppercase tracking-wider">{t(lang, 'demoBadge')}</span>
        </div>
      </footer>

      {/* Bottom nav — mobile only, only when logged in */}
      {clerkConfigured && isSignedIn && (
        <div className="md:hidden">
          <BottomNav lang={lang} />
        </div>
      )}
    </div>
  );
}
