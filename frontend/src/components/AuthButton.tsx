import { SignInButton, UserButton } from '@clerk/clerk-react';
import { useAppAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import type { Lang } from '../i18n';

interface AuthButtonProps {
  lang: Lang;
}

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function AuthButton({ lang }: AuthButtonProps) {
  const { isLoaded, isSignedIn } = useAppAuth();

  // Don't render anything if Clerk is not configured or not loaded
  if (!clerkPubKey || !isLoaded) return null;

  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
          {t(lang, 'signIn')}
        </button>
      </SignInButton>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <UserButton afterSignOutUrl="/openinvoice/" />
    </div>
  );
}
