import { AuthProvider, useAuth } from './contexts/AuthContext';
import { OrganizationsProvider } from './contexts/OrganizationsContext';
import { ServersProvider } from './contexts/ServersContext';
import { TerminalProvider } from './contexts/TerminalContext';
import { SnippetsProvider } from './contexts/SnippetsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { HostKeyProvider } from './contexts/HostKeyContext';
import { StartupScreen } from './components/StartupScreen';
import { LoginPage } from './pages/LoginPage';
import { SetupMasterKeyPage } from './pages/SetupMasterKeyPage';
import { MainLayout } from './layouts/MainLayout';
import { TooltipLayer } from './components/ui/Tooltip';

function AppContent() {
  const {
    isAuthenticated,
    isLoading,
    hasMasterKey,
    needsMasterKeySetup,
    initTimedOut,
    retryInitialize,
  } = useAuth();

  if (isLoading) {
    return <StartupScreen variant="loading" onRetry={retryInitialize} />;
  }

  // A timed-out start says nothing about whether the session is still good, so
  // don't drop the user on the login form as if they had been signed out.
  if (initTimedOut) {
    return <StartupScreen variant="unreachable" onRetry={retryInitialize} />;
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
      <TooltipLayer />
    </ThemeProvider>
  );
}
