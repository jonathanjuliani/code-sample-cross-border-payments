import {
  type OpsConfig,
  OpsConfigSchema,
  type OpsEvent,
  OpsEventSchema,
  type OpsSummary,
  OpsSummarySchema,
  type SimulationFlags,
  SimulationFlagsSchema,
} from '@payout/shared';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { request } from '../state/api.ts';
import { useLiveOps } from '../state/liveOps.ts';
import { PageHead } from '../ui/PageHead.tsx';
import { OpsConfigPanel } from './ops/Config.tsx';
import { OpsEvents } from './ops/Events.tsx';
import { type InspectorState, OpsInspector } from './ops/Inspector.tsx';
import { OpsRecon } from './ops/Recon.tsx';
import { OpsSimulation } from './ops/Simulation.tsx';
import { OpsStuck } from './ops/Stuck.tsx';
import { OpsSummaryPanel } from './ops/Summary.tsx';

const EventsSchema = z.array(OpsEventSchema);

export function Ops() {
  const [opsOff, setOpsOff] = useState(false);
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [flags, setFlags] = useState<SimulationFlags | null>(null);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [config, setConfig] = useState<OpsConfig | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [payoutFilter, setPayoutFilter] = useState('');
  const [recon, setRecon] = useState('');
  const [inspectId, setInspectId] = useState('');
  const [inspector, setInspector] = useState<InspectorState | null>(null);

  const load = useCallback(async () => {
    const sum = await request('/ops/summary', { method: 'GET', schema: OpsSummarySchema });
    if (!sum.ok) {
      if (sum.status === 404) {
        setOpsOff(true);
        return true;
      }
      return false;
    }
    setOpsOff(false);
    setSummary(sum.data);

    const sim = await request('/ops/simulation', { method: 'GET', schema: SimulationFlagsSchema });
    if (sim.ok) setFlags(sim.data);

    const q = new URLSearchParams();
    if (kindFilter) q.set('kind', kindFilter);
    if (payoutFilter) q.set('payoutId', payoutFilter);
    const ev = await request(`/ops/events?${q.toString()}`, {
      method: 'GET',
      schema: EventsSchema,
    });
    if (ev.ok) setEvents([...ev.data].reverse());

    const cfg = await request('/ops/config', { method: 'GET', schema: OpsConfigSchema });
    if (cfg.ok) setConfig(cfg.data);

    const rec = await request('/reconciliation', {
      method: 'GET',
      schema: z.object({
        items: z.array(z.unknown()),
        totals: z.unknown().optional(),
      }),
    });
    if (rec.ok) setRecon(JSON.stringify(rec.data, null, 2));

    return true;
  }, [kindFilter, payoutFilter]);

  const { transport } = useLiveOps({ while: !opsOff, load });

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(key: keyof SimulationFlags, value: boolean | number) {
    setFlags((prev) => (prev ? { ...prev, [key]: value } : prev));
    const res = await request('/ops/simulation', {
      method: 'PUT',
      schema: SimulationFlagsSchema,
      body: JSON.stringify({ [key]: value }),
    });
    if (res.ok) setFlags(res.data);
  }

  async function reset() {
    const res = await request('/ops/simulation/reset', {
      method: 'POST',
      schema: SimulationFlagsSchema,
    });
    if (res.ok) setFlags(res.data);
  }

  async function loadInspector(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    const res = await request(`/ops/payouts/${trimmed}`, {
      method: 'GET',
      schema: z.object({
        flaggedAt: z.string().nullable(),
        legs: z.array(
          z.object({
            leg: z.string(),
            status: z.string(),
            provider_ref: z.string().nullable(),
          }),
        ),
      }),
    });
    if (!res.ok) {
      setInspector({
        payoutId: trimmed,
        flaggedAt: null,
        legs: [],
        actionMsg: `Could not load ${trimmed}`,
      });
      return;
    }
    setInspector({
      payoutId: trimmed,
      flaggedAt: res.data.flaggedAt,
      legs: res.data.legs,
      actionMsg: '',
    });
  }

  async function rerunStatusQuery(leg: string) {
    if (!inspector) return;
    const res = await request(`/ops/payouts/${inspector.payoutId}/status-query`, {
      method: 'POST',
      schema: z.object({ ok: z.literal(true), outboxId: z.number() }),
      body: JSON.stringify({ leg }),
    });
    if (res.ok) {
      setInspector({
        ...inspector,
        actionMsg: `Queued status.query for ${leg} (outbox #${res.data.outboxId})`,
      });
      await load();
      return;
    }
    setInspector({ ...inspector, actionMsg: `Re-run failed (${res.status})` });
  }

  async function flagForReview() {
    if (!inspector) return;
    const res = await request(`/ops/payouts/${inspector.payoutId}/flag`, {
      method: 'POST',
      schema: z.object({ ok: z.literal(true), flaggedAt: z.string() }),
    });
    if (res.ok) {
      setInspector({
        ...inspector,
        flaggedAt: res.data.flaggedAt,
        actionMsg: 'Flagged for review',
      });
      await load();
      return;
    }
    setInspector({ ...inspector, actionMsg: `Flag failed (${res.status})` });
  }

  if (opsOff) {
    return (
      <div>
        <PageHead
          eyebrow="Ops · not part of the product"
          title="Ops"
          lede="OPS_ENABLED is off on the API. Simulation and server visibility are unavailable."
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Ops · not part of the product"
        title="Ops"
        lede="Force provider behaviour and inspect what the server did."
      />
      <span data-testid="ops-transport" hidden>
        {transport}
      </span>

      <OpsSimulation
        flags={flags}
        onToggle={(key, value) => void toggle(key, value)}
        onReset={() => void reset()}
      />
      <OpsSummaryPanel summary={summary} />
      <OpsStuck
        stuck={summary?.stuck ?? []}
        onSelect={(payoutId) => {
          setInspectId(payoutId);
          void loadInspector(payoutId);
        }}
      />
      <OpsInspector
        inspectId={inspectId}
        onInspectIdChange={setInspectId}
        onLoad={() => void loadInspector(inspectId)}
        inspector={inspector}
        onRerunStatusQuery={(leg) => void rerunStatusQuery(leg)}
        onFlagForReview={() => void flagForReview()}
      />
      <OpsEvents
        events={events}
        kindFilter={kindFilter}
        payoutFilter={payoutFilter}
        onKindFilterChange={setKindFilter}
        onPayoutFilterChange={setPayoutFilter}
      />
      <OpsRecon recon={recon} />
      <OpsConfigPanel config={config} />
    </div>
  );
}
