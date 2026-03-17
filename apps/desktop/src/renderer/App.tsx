import { AuthProvider, useAuth } from './contexts/AuthContext';
import { OrganizationsProvider } from './contexts/OrganizationsContext';
import { ServersProvider } from './contexts/ServersContext';
import { TerminalProvider } from './contexts/TerminalContext';
import { LoginPage } from './pages/LoginPage';
import { SetupMasterKeyPage } from './pages/SetupMasterKeyPage';
import { MainLayout } from './layouts/MainLayout';

function AppContent() {
  const { isAuthenticated, isLoading, hasMasterKey, needsMasterKeySetup } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <span className="text-gray-400">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (needsMasterKeySetup || !hasMasterKey) {
    return <SetupMasterKeyPage />;
  }

  return (
    <OrganizationsProvider>
      <ServersProvider>
        <TerminalProvider>
          <MainLayout />
        </TerminalProvider>
      </ServersProvider>
    </OrganizationsProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
