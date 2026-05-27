import { AuthProvider, useAuth } from './contexts/AuthContext';
import { OrganizationsProvider } from './contexts/OrganizationsContext';
import { ServersProvider } from './contexts/ServersContext';
import { TerminalProvider } from './contexts/TerminalContext';
import { SnippetsProvider } from './contexts/SnippetsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { HostKeyProvider } from './contexts/HostKeyContext';
import { LoginPage } from './pages/LoginPage';
import { SetupMasterKeyPage } from './pages/SetupMasterKeyPage';
import { MainLayout } from './layouts/MainLayout';

function AppContent() {
  const { isAuthenticated, isLoading, hasMasterKey, needsMasterKeySetup } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-app">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="text-fg-muted">Loading...</span>
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
        <SnippetsProvider>
          <HostKeyProvider>
            <TerminalProvider>
              <MainLayout />
            </TerminalProvider>
          </HostKeyProvider>
        </SnippetsProvider>
      </ServersProvider>
    </OrganizationsProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
