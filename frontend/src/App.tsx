import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useAppAuth } from './contexts/AuthContext';
import AuthButton from './components/AuthButton';
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <img src="/openinvoice/logo.png" alt="OpenInvoice" className="h-9 w-9" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t(lang, 'title')}</h1>
              <p className="mt-0.5 text-sm text-slate-500 hidden sm:block">
                {t(lang, 'subtitle')}
              </p>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>
                {t(lang, 'navDemo')}
              </NavLink>
              {clerkConfigured && isSignedIn && (
                <>
                  <NavLink to="/history" className={navLinkClass}>
                    {t(lang, 'navHistory')}
                  </NavLink>
                  <NavLink to="/dashboard" className={navLinkClass}>
                    {t(lang, 'navDashboard')}
                  </NavLink>
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Auth button */}
            <AuthButton lang={lang} />

            {/* Language toggle */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setLang('en')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  lang === 'en'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('fr')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  lang === 'fr'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                FR
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
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
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between text-xs text-slate-400">
          <span>{t(lang, 'footerText')}</span>
          <span>{t(lang, 'footerPowered')}</span>
        </div>
      </footer>
    </div>
  );
}
