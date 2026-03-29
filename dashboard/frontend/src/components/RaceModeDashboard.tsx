/**
 * RaceModeDashboard — Clean 3-column race view with live LLM advice
 *
 * Layout mirrors the paper figure:
 *   Header: Logo | Lap/Position/Track | LLM Status
 *   Body:   Timing & Gaps | Tyre & Fuel | ERS & Strategy
 *   Footer: Weather | Safety Car | DRS
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTelemetry } from '../hooks/useTelemetry';
import { useERSStrategy } from '../hooks/useERSStrategy';
import { useLivePitStrategy } from '../hooks/useLivePitStrategy';
import { useEngineerTriggers } from '../hooks/useEngineerTriggers';
import { useTyreSets } from '../hooks/useTyreSets';
import { convertTelemetry, formatTime, getF1TrackName } from '../utils/telemetryConverter';
import {
  initLLMEngineer,
  getLLMEngineer,
  type RaceContext,
  type TireData,
  type EngineerMessage,
} from '../services/llm_engineer';
import { getERSAdvisor } from '../services/ers_strategy';
import { TRACK_NAMES } from '../services/research_logger';
import type { TelemetryData, MultiCarTelemetryData } from '../types/telemetry';
import type { TriggerEvent } from '../hooks/useMLPredictions';
import { Radio, Zap, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEAM_COLORS: Record<number, string> = {
  0:  '#00D2BE', // Mercedes
  1:  '#E8002D', // Ferrari
  2:  '#3671C6', // Red Bull
  3:  '#64C4FF', // Williams
  4:  '#358C75', // Aston Martin
  5:  '#FF87BC', // Alpine
  6:  '#FF8000', // McLaren
  7:  '#6692FF', // RB / AlphaTauri
  8:  '#B6BABD', // Haas
  9:  '#52E252', // Kick Sauber
  10: '#B6BABD', // backmarker fallback
};

function teamColor(teamId: number | undefined): string {
  return TEAM_COLORS[teamId ?? 10] ?? '#6B7280';
}

function ersModeName(mode: number | undefined): string {
  switch (mode) {
    case 1: return 'MEDIUM';
    case 2: return 'HOTLAP';
    case 3: return 'OVERTAKE';
    default: return 'NONE';
  }
}

function ersModeColor(mode: number | undefined): string {
  switch (mode) {
    case 3: return 'bg-red-500 text-white';
    case 2: return 'bg-yellow-400 text-black';
    case 1: return 'bg-blue-500 text-white';
    default: return 'bg-gray-600 text-gray-300';
  }
}

function weatherLabel(code: number | undefined): string {
  switch (code) {
    case 0: return 'Clear';
    case 1: return 'Light Cloud';
    case 2: return 'Overcast';
    case 3: return 'Light Rain';
    case 4: return 'Heavy Rain';
    case 5: return 'Storm';
    default: return 'Clear';
  }
}

function safetyCarLabel(code: number | undefined): string {
  switch (code) {
    case 1: return 'Safety Car';
    case 2: return 'VSC';
    case 3: return 'Formation Lap';
    default: return 'None';
  }
}

function compoundColor(compound: string | undefined): string {
  const c = (compound ?? '').toLowerCase();
  if (c.includes('soft'))   return '#FF0000';
  if (c.includes('medium')) return '#FFC906';
  if (c.includes('hard'))   return '#FFFFFF';
  if (c.includes('inter'))  return '#39B54A';
  if (c.includes('wet'))    return '#0067FF';
  return '#9CA3AF';
}

function compoundLabel(compound: string | undefined): string {
  const c = (compound ?? '').toLowerCase();
  if (c.includes('soft'))   return 'SOFT';
  if (c.includes('medium')) return 'MEDIUM';
  if (c.includes('hard'))   return 'HARD';
  if (c.includes('inter'))  return 'INTER';
  if (c.includes('wet'))    return 'WET';
  return 'UNKNOWN';
}

function wearColor(wear: number): string {
  if (wear > 70) return '#EF4444';
  if (wear > 45) return '#F59E0B';
  return '#22C55E';
}

function fmtGap(gap: number | undefined | null): string {
  if (gap == null || !Number.isFinite(gap)) return '—';
  return `+${gap.toFixed(2)}s`;
}

function fmtLap(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '—:——.———';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

// ─── Tyre Ring SVG ──────────────────────────────────────────────────────────

function TyreRing({
  label,
  wear,
  size = 76,
}: {
  label: string;
  wear: number;
  size?: number;
}) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * (1 - wear / 100);
  const color = wearColor(wear);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-gray-400 font-mono">{label}</span>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" style={{ transform: 'rotate(-90deg)' }}>
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#374151"
            strokeWidth={8}
          />
          {/* Wear arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={filled}
            strokeLinecap="round"
          />
        </svg>
        <div
          className="absolute inset-0 flex items-center justify-center text-sm font-bold"
          style={{ color }}
        >
          {Math.round(wear)}%
        </div>
      </div>
    </div>
  );
}

// ─── ERS Battery Bar ────────────────────────────────────────────────────────

function ERSBar({ percent }: { percent: number }) {
  const clamp = Math.max(0, Math.min(100, percent));
  const color =
    clamp < 20 ? '#EF4444' : clamp < 50 ? '#F59E0B' : '#22C55E';

  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
        <span>ERS BATTERY</span>
        <span style={{ color }} className="font-bold">
          {Math.round(clamp)}%
        </span>
      </div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clamp}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Pit Window Bar ─────────────────────────────────────────────────────────

function PitWindowBar({
  currentLap,
  totalLaps,
  windowStart,
  windowEnd,
}: {
  currentLap: number;
  totalLaps: number;
  windowStart: number;
  windowEnd: number;
}) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / Math.max(totalLaps, 1)) * 100));
  const current = pct(currentLap);
  const start   = pct(windowStart);
  const end     = pct(windowEnd);
  const inWindow = currentLap >= windowStart && currentLap <= windowEnd;

  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
        <span>PIT WINDOW</span>
        <span className={inWindow ? 'text-green-400 font-bold' : 'text-gray-400'}>
          {inWindow ? 'OPEN' : windowStart > currentLap ? `LAP ${windowStart}–${windowEnd}` : 'PASSED'}
        </span>
      </div>
      <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
        {/* Window zone */}
        <div
          className="absolute h-full bg-blue-500/40 rounded"
          style={{ left: `${start}%`, width: `${end - start}%` }}
        />
        {/* Current lap needle */}
        <div
          className="absolute h-full w-0.5 bg-white"
          style={{ left: `${current}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
        <span>Lap {windowStart}</span>
        <span>Lap {windowEnd}</span>
      </div>
    </div>
  );
}

// ─── Timing Tower Row ───────────────────────────────────────────────────────

function TimingRow({
  pos,
  name,
  gap,
  teamId,
  isPlayer,
  compound,
}: {
  pos: number;
  name: string;
  gap: number | null | undefined;
  teamId: number | undefined;
  isPlayer: boolean;
  compound?: string;
}) {
  const color = teamColor(teamId);
  return (
    <div
      className={`flex items-center gap-2 px-2 py-0.5 rounded text-xs ${
        isPlayer ? 'bg-white/10' : ''
      }`}
    >
      <span className="w-5 text-gray-400 text-right font-mono">P{pos}</span>
      <div className="w-1 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <span className={`flex-1 truncate font-medium ${isPlayer ? 'text-white' : 'text-gray-300'}`}>
        {name}
      </span>
      {compound && (
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: compoundColor(compound) }}
        />
      )}
      <span className="text-gray-400 font-mono w-14 text-right">
        {pos === 1 ? 'Leader' : gap != null && Number.isFinite(gap) ? `+${gap.toFixed(2)}` : '—'}
      </span>
    </div>
  );
}

// ─── API Key prompt ──────────────────────────────────────────────────────────

function ApiKeyPrompt({ onSet }: { onSet: (key: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg border border-gray-600">
      <p className="text-xs text-gray-400">Enter OpenAI key to enable live LLM advice</p>
      <div className="flex gap-2">
        <input
          type="password"
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="sk-..."
          className="flex-1 bg-gray-900 text-white text-xs px-2 py-1.5 rounded border border-gray-600 outline-none focus:border-blue-500"
        />
        <button
          onClick={() => { if (val.trim()) onSet(val.trim()); }}
          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export const RaceModeDashboard: React.FC = () => {
  const { telemetry: rawTelemetry, multiCarData, connectionStatus } = useTelemetry();
  const { tyreSets } = useTyreSets();
  const stdTelemetry = rawTelemetry ? convertTelemetry(rawTelemetry) : null;

  // Strategy & ERS hooks
  const playerCar = multiCarData?.cars?.find(c => c.is_player === 1);
  const isInBattle = !!(
    playerCar?.gap_to_car_ahead != null && playerCar.gap_to_car_ahead < 1.5
  );

  const ersStrategy = useERSStrategy(rawTelemetry, multiCarData ?? null, isInBattle);

  const liveStrategy = useLivePitStrategy({
    telemetry: stdTelemetry,
    multiCarData: multiCarData ?? null,
    tyreSets,
  });

  const engineerTriggers = useEngineerTriggers(
    rawTelemetry as unknown as Record<string, unknown>,
    multiCarData ?? null,
    liveStrategy.ready ? liveStrategy : null,
    { enabled: connectionStatus === 'connected' }
  );

  // ── LLM state ────────────────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem('openaiApiKey') ?? ''
  );
  const [llmMessages, setLlmMessages] = useState<EngineerMessage[]>([]);
  const [llmLoading, setLlmLoading] = useState(false);
  const processedRef = useRef<Set<string>>(new Set());
  const llmInitialized = useRef(false);

  const saveApiKey = useCallback((key: string) => {
    localStorage.setItem('openaiApiKey', key);
    setApiKey(key);
  }, []);

  useEffect(() => {
    if (apiKey && !llmInitialized.current) {
      initLLMEngineer(apiKey);
      llmInitialized.current = true;
    }
  }, [apiKey]);

  // Build race context for LLM calls
  const buildContext = useCallback((): RaceContext => {
    const t = rawTelemetry as Record<string, unknown> | null ?? {};
    const tireWear = (t.tire_wear as number[] | undefined);
    const tireWearFL = tireWear?.[0] ?? 0;
    const tireWearFR = tireWear?.[1] ?? 0;
    const tireWearRL = tireWear?.[2] ?? 0;
    const tireWearRR = tireWear?.[3] ?? 0;
    const maxWear = Math.max(tireWearFL, tireWearFR, tireWearRL, tireWearRR);
    const avgWear = (tireWearFL + tireWearFR + tireWearRL + tireWearRR) / 4;
    const currentLap = (t.current_lap_num as number) ?? 1;
    const totalLaps  = (t.total_laps as number) ?? 50;
    const lapsRemaining = Math.max(1, totalLaps - currentLap);

    const tires: TireData = {
      compound: (t.tire_compound as string) ?? 'medium',
      age: (t.tire_age_laps as number) ?? 0,
      wear: { fl: tireWearFL, fr: tireWearFR, rl: tireWearRL, rr: tireWearRR, max: maxWear, avg: avgWear },
      temps: { fl: 90, fr: 90, rl: 90, rr: 90 },
      pressure: { fl: 23, fr: 23, rl: 21, rr: 21 },
    };

    const trackId = t.track_id as number | undefined;
    const trackName = trackId !== undefined ? (TRACK_NAMES[trackId] ?? getF1TrackName(trackId)) : undefined;

    const ersAdvisor = getERSAdvisor();
    const ersAdvice = rawTelemetry
      ? ersAdvisor.generateAdvice(rawTelemetry as TelemetryData, multiCarData ?? null, isInBattle)
      : undefined;

    const plan = liveStrategy.ready ? liveStrategy.plans[liveStrategy.primaryPlanIndex] : null;
    const nextStop = plan?.nextStop;

    return {
      currentLap,
      totalLaps,
      position: (t.position as number) ?? 0,
      trackName,
      lastLapTime:    fmtLap(t.last_lap_time as number),
      bestLapTime:    fmtLap(t.best_lap_time as number),
      currentLapTime: fmtLap(t.current_lap_time as number),
      gapAhead:  playerCar?.gap_to_car_ahead ?? null,
      gapBehind: null,
      tires,
      tireCompound:     (t.tire_compound as string) ?? 'unknown',
      tireAge:          (t.tire_age_laps as number) ?? 0,
      tireWearStatus:   maxWear > 70 ? 'critical' : maxWear > 45 ? 'caution' : 'healthy',
      tireRemainingLaps: Math.min(liveStrategy.tyreHealth?.lapsTo70 ?? lapsRemaining, lapsRemaining),
      fuelRemaining:     (t.fuel_in_tank as number) ?? 0,
      fuelLapsRemaining: (t.fuel_remaining_laps as number) ?? 0,
      ersPercent:  ersStrategy.batteryPercent,
      ersMode:     ersModeName(t.ers_deploy_mode as number),
      ersAdvice,
      pitWindow: nextStop ? { start: nextStop.windowStart, end: nextStop.windowEnd } : undefined,
      pitStatus: plan?.status,
    };
  }, [rawTelemetry, multiCarData, isInBattle, ersStrategy, liveStrategy, playerCar]);

  // Fire LLM on new triggers
  useEffect(() => {
    if (!engineerTriggers.length || !apiKey) return;
    const latest = engineerTriggers[engineerTriggers.length - 1];
    const key = `${latest.type}-${latest.cooldown_key}`;
    if (processedRef.current.has(key)) return;
    processedRef.current.add(key);

    if (latest.priority === 'low') return;

    const service = getLLMEngineer();
    if (!service) return;

    setLlmLoading(true);
    service
      .generateFromTrigger(latest, buildContext())
      .then(({ message }) => {
        setLlmMessages(prev => [...prev.slice(-9), message]);
        setLlmLoading(false);
      })
      .catch(() => setLlmLoading(false));
  }, [engineerTriggers, apiKey, buildContext]);

  // ── Derived telemetry values ──────────────────────────────────────────────
  const t = rawTelemetry;
  const currentLap  = t?.current_lap_num ?? 0;
  const totalLaps   = (t as any)?.total_laps ?? 0;
  const position    = t?.position ?? 0;
  const trackId     = (t as any)?.track_id as number | undefined;
  const trackName   = trackId !== undefined ? getF1TrackName(trackId) : 'Connecting…';
  const totalLapsLabel = totalLaps > 0 ? totalLaps : '—';
  const distancePct = totalLaps > 0 ? Math.round((currentLap / totalLaps) * 100) : 0;

  const tireWear  = t?.tire_wear ?? [0, 0, 0, 0];
  const tireAge   = t?.tire_age_laps ?? 0;
  const compound  = t?.tire_compound;
  const fuelLaps  = t?.fuel_remaining_laps ?? 0;

  const ersPercent = ersStrategy.batteryPercent;
  const ersMode    = (t as any)?.ers_deploy_mode as number | undefined;

  const drsAvail  = (t?.drs_allowed ?? 0) === 1;
  const drsOpen   = ((t as any)?.drs_open ?? 0) === 1;
  const weather   = (t as any)?.weather as number | undefined;
  const trackTemp = (t as any)?.track_temperature as number | undefined;
  const scStatus  = (t as any)?.safety_car_status as number | undefined;

  // Timing tower: sort multicar by position, show top 10
  const sortedCars = [...(multiCarData?.cars ?? [])]
    .filter(c => c.position > 0)
    .sort((a, b) => a.position - b.position)
    .slice(0, 10);

  // Gaps: find player car in multicar for gap to car ahead/behind
  const gapAhead  = playerCar?.gap_to_car_ahead;
  const aheadCar  = sortedCars.find(c => c.position === position - 1);
  const behindCar = sortedCars.find(c => c.position === position + 1);

  // Pit window from strategy
  const plan        = liveStrategy.ready ? liveStrategy.plans[liveStrategy.primaryPlanIndex] : null;
  const nextStop    = plan?.nextStop;
  const winStart    = nextStop?.windowStart ?? t?.pit_window_ideal_lap ?? 0;
  const winEnd      = nextStop?.windowEnd   ?? t?.pit_window_latest_lap ?? 0;

  // Latest LLM message
  const latestMsg = llmMessages[llmMessages.length - 1];

  const connected = connectionStatus === 'connected';
  const llmReady  = !!apiKey && llmInitialized.current;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-tight">⬡ Atlas Racing</span>
        </div>

        <div className="flex items-center gap-6 text-sm font-medium">
          <span className="text-gray-300">
            Lap <span className="text-white font-bold">{currentLap || '—'}/{totalLapsLabel}</span>
          </span>
          <span className="text-gray-300">
            <span className="text-white font-bold">P{position || '—'}</span>
          </span>
          <span className="text-white font-bold">{trackName}</span>
          <span className="text-gray-400">{distancePct}% Distance</span>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
            connected ? 'text-green-400' : 'text-red-400'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            {connected ? 'LIVE' : 'OFFLINE'}
          </div>
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
            llmReady ? 'text-emerald-400' : 'text-gray-500'
          }`}>
            <Radio className="w-3 h-3" />
            LLM: {llmReady ? 'Active' : 'Off'}
          </div>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Timing & Gaps ──────────────────────────────────────────── */}
        <section className="flex flex-col w-72 flex-shrink-0 border-r border-gray-700 bg-gray-900/50 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700">
            <h2 className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">
              Timing &amp; Gaps
            </h2>
          </div>

          <div className="p-4 flex flex-col gap-4">
            {/* Current lap time */}
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Lap Time</div>
              <div className="text-3xl font-mono font-bold text-white tracking-tight">
                {fmtLap(t?.current_lap_time)}
              </div>
            </div>

            {/* Best lap */}
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Best Lap</div>
              <div className="text-xl font-mono font-semibold text-purple-400">
                {fmtLap(t?.best_lap_time)}
              </div>
            </div>

            {/* Last lap */}
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Last Lap</div>
              <div className="text-xl font-mono font-semibold text-gray-300">
                {fmtLap(t?.last_lap_time)}
              </div>
            </div>

            {/* Gaps */}
            <div className="flex flex-col gap-2 pt-1 border-t border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Gap to P{position - 1} Ahead
                </span>
                <span className="text-green-400 font-mono font-bold text-sm">
                  {fmtGap(gapAhead)}
                </span>
              </div>
              {aheadCar && (
                <div className="text-[10px] text-gray-500 text-right">{aheadCar.driver_name}</div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Gap to P{position + 1} Behind
                </span>
                <span className="text-gray-300 font-mono font-bold text-sm">
                  {behindCar?.gap_to_car_ahead != null
                    ? `+${behindCar.gap_to_car_ahead.toFixed(2)}s`
                    : '—'}
                </span>
              </div>
              {behindCar && (
                <div className="text-[10px] text-gray-500 text-right">{behindCar.driver_name}</div>
              )}
            </div>
          </div>

          {/* Timing tower */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider px-2 pb-1">
              Tower
            </div>
            {sortedCars.length > 0 ? (
              sortedCars.map(car => (
                <TimingRow
                  key={car.car_index}
                  pos={car.position}
                  name={car.driver_name || `Car ${car.car_index}`}
                  gap={car.gap_to_leader}
                  teamId={car.team_id}
                  isPlayer={car.is_player === 1}
                  compound={car.tyre_compound}
                />
              ))
            ) : (
              <div className="text-gray-600 text-xs px-2">No multi-car data</div>
            )}
          </div>
        </section>

        {/* ── CENTRE: Tyre & Fuel ───────────────────────────────────────────── */}
        <section className="flex flex-col flex-1 border-r border-gray-700 bg-gray-900/30 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700">
            <h2 className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">
              Tyre &amp; Fuel
            </h2>
          </div>

          <div className="flex flex-col flex-1 items-center justify-center gap-8 px-6">
            {/* Tyre rings 2x2 */}
            <div className="flex flex-col gap-4 items-center">
              <div className="flex gap-8">
                <TyreRing label="FL" wear={tireWear[0] ?? 0} size={84} />
                <TyreRing label="FR" wear={tireWear[1] ?? 0} size={84} />
              </div>
              <div className="flex gap-8">
                <TyreRing label="RL" wear={tireWear[2] ?? 0} size={84} />
                <TyreRing label="RR" wear={tireWear[3] ?? 0} size={84} />
              </div>
            </div>

            {/* Compound badge */}
            <div className="flex flex-col items-center gap-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Compound</div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: compoundColor(compound) }}
                />
                <span
                  className="text-lg font-bold"
                  style={{ color: compoundColor(compound) }}
                >
                  {compoundLabel(compound)}
                </span>
              </div>
            </div>

            {/* Tyre age + fuel */}
            <div className="flex gap-12 w-full justify-center">
              <div className="flex flex-col items-center gap-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Tyre Age</div>
                <div className="text-2xl font-bold text-white">{tireAge} <span className="text-sm text-gray-400">laps</span></div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Fuel Remaining</div>
                <div className={`text-2xl font-bold ${fuelLaps < 2 ? 'text-red-400' : fuelLaps < 5 ? 'text-yellow-400' : 'text-white'}`}>
                  {fuelLaps.toFixed(2)} <span className="text-sm text-gray-400">laps</span>
                </div>
              </div>
            </div>

            {/* Tyre health advisory */}
            {liveStrategy.tyreHealth && (
              <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full ${
                liveStrategy.tyreHealth.status === 'critical'
                  ? 'bg-red-900/50 text-red-400'
                  : liveStrategy.tyreHealth.status === 'caution'
                  ? 'bg-yellow-900/50 text-yellow-400'
                  : 'bg-green-900/50 text-green-400'
              }`}>
                {liveStrategy.tyreHealth.status === 'critical' ? (
                  <AlertTriangle className="w-3 h-3" />
                ) : (
                  <CheckCircle className="w-3 h-3" />
                )}
                {liveStrategy.tyreHealth.status === 'critical'
                  ? `Critical — ~${liveStrategy.tyreHealth.lapsTo70} laps to 70%`
                  : liveStrategy.tyreHealth.status === 'caution'
                  ? `Caution — ${liveStrategy.tyreHealth.lapsTo70} laps to 70%`
                  : 'Tyres healthy'}
              </div>
            )}
          </div>
        </section>

        {/* ── RIGHT: ERS & Strategy ──────────────────────────────────────────── */}
        <section className="flex flex-col w-80 flex-shrink-0 bg-gray-900/50 overflow-y-auto">
          <div className="px-4 py-2 border-b border-gray-700">
            <h2 className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase">
              ERS &amp; Strategy
            </h2>
          </div>

          <div className="flex flex-col gap-5 p-4">
            {/* ERS Battery */}
            <ERSBar percent={ersPercent} />

            {/* ERS Mode */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">ERS Mode</span>
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${ersModeColor(ersMode)}`}>
                {ersModeName(ersMode)}
              </span>
            </div>

            {/* ERS Advice from strategy engine */}
            {ersStrategy.advice && (
              <div className="text-[11px] text-gray-400 bg-gray-800 rounded px-3 py-2 leading-relaxed">
                <Zap className="w-3 h-3 inline mr-1 text-yellow-400" />
                {ersStrategy.advice.reason}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-700" />

            {/* Pit window */}
            {winStart > 0 && winEnd > 0 ? (
              <PitWindowBar
                currentLap={currentLap}
                totalLaps={totalLaps || 50}
                windowStart={winStart}
                windowEnd={winEnd}
              />
            ) : (
              <div className="text-[10px] text-gray-600 uppercase tracking-wider">
                No pit window data
              </div>
            )}

            {/* Plan label */}
            {plan && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Plan {plan.id} — {plan.title}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  plan.status === 'box'     ? 'bg-red-600 text-white' :
                  plan.status === 'prepare' ? 'bg-yellow-500 text-black' :
                                              'bg-gray-700 text-gray-300'
                }`}>
                  {plan.status.toUpperCase()}
                </span>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-700" />

            {/* LLM Advice */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">LLM Advice</span>
                {llmLoading && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
              </div>

              {!apiKey ? (
                <ApiKeyPrompt onSet={saveApiKey} />
              ) : latestMsg ? (
                <div className="bg-green-950/60 border border-green-700/50 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Radio className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-green-100 leading-relaxed">{latestMsg.content}</p>
                  </div>
                  <div className="text-[10px] text-green-700 mt-2">
                    {new Date(latestMsg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-gray-500 text-xs">
                    <Radio className="w-3 h-3" />
                    <span>Waiting for race events…</span>
                  </div>
                </div>
              )}

              {/* Message history (last 3) */}
              {llmMessages.length > 1 && (
                <div className="mt-3 flex flex-col gap-2">
                  {[...llmMessages].slice(-4, -1).reverse().map((msg, i) => (
                    <div key={i} className="text-[11px] text-gray-500 pl-2 border-l border-gray-700 leading-relaxed">
                      {msg.content}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="flex items-center justify-between px-6 py-2 bg-gray-900 border-t border-gray-700 flex-shrink-0 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span>☀</span>
          <span>{weatherLabel(weather)}</span>
          {trackTemp != null && <span>· {Math.round(trackTemp)}°C track</span>}
        </div>
        <div className={scStatus ? 'text-yellow-400 font-semibold' : ''}>
          Safety Car: {safetyCarLabel(scStatus)}
        </div>
        <div className={drsOpen ? 'text-green-400 font-semibold' : drsAvail ? 'text-gray-300' : 'text-gray-600'}>
          DRS: {drsOpen ? 'Open' : drsAvail ? 'Available' : 'Unavailable'}
        </div>
      </footer>
    </div>
  );
};
