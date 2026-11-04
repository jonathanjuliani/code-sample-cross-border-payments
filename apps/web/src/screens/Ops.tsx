import {
  OpsConfigSchema,
  type OpsSummary,
  OpsSummarySchema,
  type SimulationFlags,
  SimulationFlagsSchema,
} from '@payout/shared';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { request } from '../state/api.ts';
import { useLiveOps } from '../state/liveOps.ts';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { PageHead } from '../ui/PageHead.tsx';
import { SectionHead } from '../ui/SectionHead.tsx';
import styles from './Ops.module.css';

const EventsSchema = z.array(
  z.object({
    id: z.number(),
    at: z.string(),
    kind: z.string(),
    level: z.string(),
    payoutId: z.string().nullable(),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).nullable(),
  }),
);

const SWITCHES: Array<keyof SimulationFlags> = [
  'slow',
  'collect.decline',
  'transfer.timeout',
  'transfer.timeoutLost',
  'transfer.reorg',
  'deposit.rejectBank',
  'webhook.duplicate',
  'webhook.outOfOrder',
  'rate.move',
  'crash.afterCommit',
  'client.readsFail',
];

export function Ops() {
  const [opsOff, setOpsOff] = useState(false);
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [flags, setFlags] = useState<SimulationFlags | null>(null);
  const [events, setEvents] = useState<z.infer<typeof EventsSchema>>([]);
  const [config, setConfig] = useState<z.infer<typeof OpsConfigSchema> | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [payoutFilter, setPayoutFilter] = useState('');
  const [recon, setRecon] = useState<string>('');
  const [inspectId, setInspectId] = useState('');
  const [inspector, setInspector] = useState<{
    payoutId: string;
    flaggedAt: string | null;
    legs: Array<{ leg: string; status: string; provider_ref: string | null }>;
    actionMsg: string;
  } | null>(null);

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

      <Card>
        <SectionHead>Simulation</SectionHead>
        <div className={styles.switches}>
          {SWITCHES.map((key) => (
            <label key={key} className={styles.switch}>
              <input
                type="checkbox"
                name={key}
                aria-label={key}
                checked={Boolean(flags?.[key])}
                disabled={!flags}
                onChange={(e) => void toggle(key, e.target.checked)}
              />
              {key}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 'var(--s3)' }}>
          <fieldset className={styles.speed}>
            <legend className="meta">Speed</legend>
            {([1, 3, 10] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={styles.speedBtn}
                aria-pressed={flags?.speed === s}
                onClick={() => void toggle('speed', s)}
              >
                {s}×
              </button>
            ))}
          </fieldset>
          <Button onClick={() => void reset()}>Reset</Button>
        </div>
      </Card>

      <Card>
        <SectionHead>Summary</SectionHead>
        {summary ? (
          <pre className={styles.log}>
            {JSON.stringify(summary.payoutsByStatus, null, 2)}
            replays {summary.idempotentReplays} · 409 {summary.conflicts409} · 410{' '}
            {summary.expired410}
            dupes {summary.webhooksIgnoredDuplicate} · stale {summary.webhooksIgnoredStale}
            outbox {summary.outboxPending} · worker {summary.workerLastTickAt ?? '—'}
          </pre>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Card>

      <Card>
        <SectionHead>Stuck</SectionHead>
        {summary?.stuck.length ? (
          <ul>
            {summary.stuck.map((s) => (
              <li key={`${s.payoutId}-${s.leg}`} className="mono meta">
                <button
                  type="button"
                  className={styles.linkish}
                  onClick={() => {
                    setInspectId(s.payoutId);
                    void loadInspector(s.payoutId);
                  }}
                >
                  {s.payoutId}
                </button>{' '}
                · {s.leg} · {s.status} · {Math.round(s.ageMs / 1000)}s
                {s.flagged ? (
                  <span className={styles.badge} data-testid="flagged-badge">
                    Flagged
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None</p>
        )}
      </Card>

      <Card>
        <SectionHead>Payout inspector</SectionHead>
        <div className="row">
          <input
            className={styles.input}
            placeholder="payout id"
            aria-label="Inspector payout id"
            value={inspectId}
            onChange={(e) => setInspectId(e.target.value)}
          />
          <Button onClick={() => void loadInspector(inspectId)}>Load</Button>
        </div>
        {inspector ? (
          <div className="stack" style={{ marginTop: 'var(--s3)' }}>
            <p className="meta mono">
              {inspector.payoutId}
              {inspector.flaggedAt ? (
                <span className={styles.badge} data-testid="flagged-badge">
                  Flagged {inspector.flaggedAt}
                </span>
              ) : null}
            </p>
            <ul>
              {inspector.legs.map((leg) => (
                <li key={leg.leg} className="mono meta row" style={{ gap: 'var(--s2)' }}>
                  <span>
                    {leg.leg} · {leg.status}
                  </span>
                  {leg.status === 'checking' ? (
                    <Button
                      onClick={() => void rerunStatusQuery(leg.leg)}
                      data-testid={`rerun-${leg.leg}`}
                    >
                      Re-run status query
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button onClick={() => void flagForReview()} data-testid="flag-for-review">
              Flag for review
            </Button>
            {inspector.actionMsg ? (
              <p className="meta" data-testid="inspector-action">
                {inspector.actionMsg}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="muted">Enter a payout id to inspect.</p>
        )}
      </Card>

      <Card>
        <SectionHead>Server log</SectionHead>
        <div className="row">
          <input
            className={styles.input}
            placeholder="kind"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="payout id"
            value={payoutFilter}
            onChange={(e) => setPayoutFilter(e.target.value)}
          />
        </div>
        <pre className={styles.log}>
          {events.map((e) => `${e.at} [${e.kind}] ${e.payoutId ?? '-'} ${e.message}`).join('\n') ||
            'No events'}
        </pre>
      </Card>

      <Card>
        <SectionHead>Reconciliation</SectionHead>
        <pre className={styles.log}>{recon || '—'}</pre>
      </Card>

      <Card>
        <SectionHead>Config</SectionHead>
        <pre className={styles.log}>{config ? JSON.stringify(config, null, 2) : '—'}</pre>
      </Card>
    </div>
  );
}
