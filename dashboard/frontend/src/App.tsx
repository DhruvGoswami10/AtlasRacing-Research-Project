import { useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';

import { F1ProDashboard } from './components/F1ProDashboard';
import { GTEnduranceDashboard } from './components/GTEnduranceDashboard';
import { DevModeDashboard } from './components/DevModeDashboard';
import { GPRaceBoard } from './components/GPRaceBoard';
import { LiveRaceAnalysis } from './components/LiveRaceAnalysis';
import { RaceModeDashboard } from './components/RaceModeDashboard';
import { DashboardSelection } from './components/DashboardSelection';
import { Button } from './components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useTelemetry } from './hooks/useTelemetry';
import { useAuth } from './context/AuthContext';
import { AuthScreen } from './components/auth/AuthScreen';

type DashboardId =
  | 'f1-pro'
  | 'gt-endurance'
  | 'live-analysis'
  | 'dev-mode'
  | 'gp-race-board'
  | 'race-mode';
type ViewType = 'dashboard-selection' | 'dashboard';

// Main App content component (used inside HashRouter)
function AppContent() {
  const [view, setView] = useState<ViewType>('dashboard-selection');
  const [selectedDashboard, setSelectedDashboard] = useState<DashboardId | null>(null);
  const location = useLocation();

  const { telemetry, connectionStatus, connect } = useTelemetry();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      connect().catch((error) => {
        console.debug('[App] Failed to initiate telemetry connection:', error);
      });
    }
  }, [connectionStatus, connect]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onSwitchDashboard) {
      return;
    }

    const validDashboards: DashboardId[] = [
      'f1-pro',
      'gt-endurance',
      'live-analysis',
      'dev-mode',
      'gp-race-board',
    ];

    const dispose = api.onSwitchDashboard((dashboardId: string) => {
      if (!validDashboards.includes(dashboardId as DashboardId)) {
        return;
      }
      setSelectedDashboard(dashboardId as DashboardId);
      setView('dashboard');
    });

    return () => {
      if (typeof dispose === 'function') {
        dispose();
      } else {
        api.removeAllListeners?.('switch-dashboard');
      }
    };
  }, []);

  useEffect(() => {
    const handleBackToSelection = () => {
      setSelectedDashboard(null);
      setView('dashboard-selection');
    };
    window.addEventListener('atlas-back-to-selection', handleBackToSelection);
    return () => {
      window.removeEventListener('atlas-back-to-selection', handleBackToSelection);
    };
  }, []);

  useEffect(() => {
    const body = document.body;
    if (!body) {
      return;
    }

    if (view === 'dashboard') {
      body.classList.add('overflow-hidden');
    } else {
      body.classList.remove('overflow-hidden');
    }

    return () => {
      body.classList.remove('overflow-hidden');
    };
  }, [view]);

  const connectedGameName = useMemo(() => {
    const rawGame = telemetry?.game_name || (telemetry as any)?.gameName;
    if (!rawGame || typeof rawGame !== 'string') {
      return null;
    }
    return rawGame;
  }, [telemetry]);

  const handleDashboardSelect = (dashboardId: DashboardId) => {
    setSelectedDashboard(dashboardId);
    setView('dashboard');
  };

  const handleBackToSelection = () => {
    setSelectedDashboard(null);
    setView('dashboard-selection');
  };

  const showBackButton = view === 'dashboard' && selectedDashboard !== null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#05060c] via-[#070912] to-[#05060c] text-white">
        <div className="flex flex-col items-center gap-4 text-sm tracking-wide text-slate-300">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-red-400/80 border-t-transparent" />
          <span>Warming up Atlas telemetry…</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <div className="dark min-h-screen bg-background">
      {/* Fixed back button - always visible regardless of scroll/zoom */}
      {showBackButton && (
        <div className="fixed top-4 left-4 z-[9999]">
          <Button
            variant="outline"
            onClick={handleBackToSelection}
            className="flex items-center gap-2 bg-black/90 backdrop-blur-sm border-gray-600 hover:bg-black/80 text-white shadow-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
      )}

      <div className="relative min-h-screen">
        {view === 'dashboard-selection' && (
          <DashboardSelection
            onDashboardSelect={handleDashboardSelect}
            connectionStatus={connectionStatus}
            connectedGameName={connectedGameName}
          />
        )}

        {view === 'dashboard' && selectedDashboard && (
          <div className="relative h-screen overflow-auto bg-background">
            {selectedDashboard === 'gt-endurance' && <GTEnduranceDashboard />}
            {selectedDashboard === 'f1-pro' && <F1ProDashboard />}
            {selectedDashboard === 'live-analysis' && <LiveRaceAnalysis />}
            {selectedDashboard === 'dev-mode' && <DevModeDashboard />}
            {selectedDashboard === 'gp-race-board' && <GPRaceBoard />}
            {selectedDashboard === 'race-mode' && <RaceModeDashboard />}
          </div>
        )}
      </div>
    </div>
  );
}

// Root App component with HashRouter
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={<AppContent />} />
      </Routes>
    </HashRouter>
  );
}
