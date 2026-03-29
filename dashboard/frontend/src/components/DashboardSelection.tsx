import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ArrowRight, Gauge, Trophy, Code, Radio, LogOut, Flag } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type DashboardId =
  | 'f1-pro'
  | 'gt-endurance'
  | 'live-analysis'
  | 'dev-mode'
  | 'gp-race-board'
  | 'race-mode';

interface DashboardOption {
  id: DashboardId;
  name: string;
  description: string;
  features: string[];
  icon: React.ReactNode;
  status: 'stable' | 'beta' | 'new';
  category: 'f1' | 'gt' | 'direct' | 'dev';
}

const dashboards: DashboardOption[] = [
  {
    id: 'dev-mode',
    name: 'Dev Mode Dashboard',
    description:
      'Raw telemetry data viewer for development and testing - shows all implemented values',
    features: [
      'All telemetry values',
      'Game detection',
      'Driver grid info',
      'Debug information',
      'Universal for all games',
    ],
    icon: <Code className="w-6 h-6" />,
    status: 'stable',
    category: 'dev',
  },
  {
    id: 'f1-pro',
    name: 'F1 Pro Dashboard',
    description:
      'Grid-based F1 dashboard with sector timing bars, comprehensive telemetry layout, and professional F1 broadcast styling',
    features: [
      'Grid Layout System',
      'Sector Timing Bars',
      'ERS & DRS Integration',
      'Tyre Compound Display',
      'Pit Window Status',
    ],
    icon: <Trophy className="w-6 h-6" />,
    status: 'new',
    category: 'f1',
  },
  {
    id: 'gt-endurance',
    name: 'GT Endurance Dashboard',
    description: 'Clean GT racing interface inspired by modern sim racing displays',
    features: ['Central Gear Display', 'RPM Lights', 'Input Monitoring', 'Tyre Temps'],
    icon: <Gauge className="w-6 h-6" />,
    status: 'new',
    category: 'gt',
  },
  {
    id: 'live-analysis',
    name: 'Live Race Analysis',
    description:
      'Full live telemetry view with lap deltas, tyre temps/wear, inputs, and trend charts for active sessions',
    features: [
      'Real-time speed/RPM/gear and inputs',
      'Tyre temps & wear with slip detection',
      'Sector timing + steering traces',
      'Live charts sourced from telemetry stream',
      'Session insights without AI dependencies',
    ],
    icon: <Radio className="w-6 h-6" />,
    status: 'stable',
    category: 'f1',
  },
  {
    id: 'gp-race-board',
    name: 'GP Race Board',
    description:
      'Multiview race board with leaderboard, track map, telemetry traces, and tire status in a GT-style layout',
    features: [
      'Multi-car leaderboard and relative gaps',
      'Track map with opponents',
      'Input traces (throttle/brake/speed)',
      'Tyre temp cards and telemetry bars'
    ],
    icon: <Radio className="w-6 h-6" />,
    status: 'beta',
    category: 'f1',
  },
  {
    id: 'race-mode',
    name: 'Race Mode Dashboard',
    description:
      'Clean 3-column race view: timing & gaps, tyre & fuel, ERS & strategy with live LLM advice card',
    features: [
      'Timing tower with gaps',
      'Tyre wear rings (FL/FR/RL/RR)',
      'ERS battery & mode',
      'Pit window visualiser',
      'Live LLM race engineer advice',
    ],
    icon: <Flag className="w-6 h-6" />,
    status: 'new',
    category: 'f1',
  },
];

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface DashboardSelectionProps {
  onDashboardSelect: (dashboardId: DashboardId) => void;
  connectionStatus: ConnectionStatus;
  connectedGameName?: string | null;
}

export function DashboardSelection({
  onDashboardSelect,
  connectionStatus,
  connectedGameName,
}: DashboardSelectionProps) {
  const { profile, user, signOut } = useAuth();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'stable':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'beta':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'new':
        return 'bg-slate-500/15 text-slate-200 border-slate-500/30';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  const connectionLabel = (() => {
    switch (connectionStatus) {
      case 'connected':
        return connectedGameName ? `Connected • ${connectedGameName}` : 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Connection Error';
      default:
        return 'Disconnected';
    }
  })();

  const connectionPillClasses = (() => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30';
      case 'connecting':
        return 'bg-amber-500/15 text-amber-200 border border-amber-500/30';
      case 'error':
        return 'bg-rose-500/15 text-rose-200 border border-rose-500/30';
      default:
        return 'bg-slate-700/50 text-slate-200 border border-slate-600/50';
    }
  })();

  const displayName =
    profile?.username ||
    profile?.email ||
    user?.email ||
    'Driver';

  const renderDashboardCards = (dashboardList: typeof dashboards) => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
      {dashboardList.map((dashboard) => (
        <Card
          key={dashboard.id}
          className="relative overflow-hidden border-border/40 bg-card/60 backdrop-blur-sm hover:bg-card/80 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 group min-h-[420px] flex flex-col"
        >
          <CardHeader className="pb-6 px-8 pt-8 flex-shrink-0">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="p-4 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  {dashboard.icon}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-xl mb-3 leading-tight">{dashboard.name}</CardTitle>
                  <Badge
                    variant="outline"
                    className={`text-sm capitalize px-3 py-1 ${getStatusColor(dashboard.status)}`}
                  >
                    {dashboard.status}
                  </Badge>
                </div>
              </div>
            </div>
            <CardDescription className="text-base text-muted-foreground leading-relaxed">
              {dashboard.description}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-0 pb-8 px-8 flex-1 flex flex-col justify-between">
            <div className="space-y-6 flex-1">
              <div>
                <h4 className="text-base font-medium mb-4 text-muted-foreground">Key Features</h4>
                <div className="grid grid-cols-1 gap-3">
                  {dashboard.features.map((feature, index) => (
                    <div
                      key={`${dashboard.id}-feature-${index}`}
                      className="text-base text-muted-foreground flex items-center gap-3"
                    >
                      <div className="w-2 h-2 bg-primary/60 rounded-full flex-shrink-0" />
                      <span className="leading-relaxed">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Button
              onClick={() => onDashboardSelect(dashboard.id)}
              className="w-full group/btn h-12 text-base mt-6"
              variant="default"
            >
              Launch Dashboard
              <ArrowRight className="w-4 h-4 ml-2 group-hover/btn:translate-x-1 transition-transform" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-background flex flex-col">
      <div className="border-b border-border/40 bg-card/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-light tracking-[0.35em] text-foreground">
                ATLAS RACING
              </h1>
              <p className="text-muted-foreground">
                Choose a dashboard to launch your live telemetry experience.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
              <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-secondary/30 border border-border/40">
                <Radio className="w-4 h-4 text-muted-foreground" />
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${connectionPillClasses}`}>
                  {connectionLabel}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                  Welcome {displayName}
                </span>
                <Button
                  onClick={() => signOut().catch(() => undefined)}
                  variant="outline"
                  className="flex items-center gap-2 bg-card/50 hover:bg-card/80"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl mb-2 text-foreground">Available Dashboards</h2>
            <p className="text-muted-foreground">
              Choose from our collection of professional racing dashboards.
            </p>
          </div>
        </div>

        {renderDashboardCards(dashboards)}
      </div>
    </div>
  );
}

