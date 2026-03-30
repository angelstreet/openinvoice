import { useLocation, useNavigate } from 'react-router-dom';
import { useAppAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
}

export default function BottomNav({ lang }: Props) {
  const { isSignedIn } = useAppAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const clerkConfigured = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const showProtected = clerkConfigured && isSignedIn;

  const items = [
    {
      label: t(lang, 'navDemo'),
      path: '/',
      icon: (active: boolean) => (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
      ),
      show: true,
    },
    {
      label: t(lang, 'navHistory'),
      path: '/history',
      icon: (active: boolean) => (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
      show: showProtected,
    },
    {
      label: t(lang, 'navDashboard'),
      path: '/dashboard',
      icon: (active: boolean) => (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
      show: showProtected,
    },
  ];

  const visibleItems = items.filter((item) => item.show);

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 pb-[env(safe-area-inset-bottom)]">
      <nav className="flex justify-around items-center max-w-lg mx-auto h-14">
        {visibleItems.map((item) => {
          const active = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                active ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              {item.icon(active)}
              <span className={`text-[10px] ${active ? 'font-semibold' : 'font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
