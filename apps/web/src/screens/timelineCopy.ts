import type { Payout, PayoutLeg } from '@payout/shared';
import { formatMinor } from '@payout/shared';
import { legTone, type Tone } from '../state/tone.ts';
import type { TimelineStep } from '../ui/Timeline.tsx';

function fmtTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return undefined;
  }
}

function legByName(payout: Payout, name: PayoutLeg['leg']): PayoutLeg | undefined {
  return payout.legs.find((l) => l.leg === name);
}

function wordFor(status: PayoutLeg['status'], dashed: boolean): string {
  if (dashed) return 'Skipped';
  if (status === 'succeeded' || status === 'final') return 'Done';
  if (status === 'failed') return 'Failed';
  if (status === 'checking') return 'Checking';
  if (status === 'waiting') return 'Waiting';
  return 'In progress';
}

export function buildTimeline(
  payout: Payout,
  fundingMask: string,
  recipientMask: string,
): TimelineStep[] {
  const collect = legByName(payout, 'collect');
  const transfer = legByName(payout, 'transfer');
  const deposit = legByName(payout, 'deposit');
  const refund = legByName(payout, 'refund');
  const send = formatMinor(payout.sendMinor, 'USD');
  const receive = formatMinor(payout.receiveMinor, 'MXN');

  const failedEarly = payout.status === 'failed';
  const refunding = payout.status === 'refunding' || payout.status === 'refunded';

  const steps: TimelineStep[] = [];

  // Hop 1
  {
    const st = collect?.status ?? 'waiting';
    const done = st === 'succeeded';
    const fail = st === 'failed';
    let detail = `Requesting ${send} from ${fundingMask}`;
    if (done)
      detail = `Collected ${send}${collect?.updatedAt ? ` · ${fmtTime(collect.updatedAt)}` : ''}`;
    if (fail) detail = 'Your bank declined the debit. No money moved.';
    if (collect?.slow && !done && !fail) {
      detail += '. Taking longer than usual. Nothing is wrong yet.';
    }
    const at1 = done || fail ? fmtTime(collect?.updatedAt) : undefined;
    steps.push({
      tone: fail ? 'danger' : done ? 'success' : legTone(st),
      index: '01',
      word: wordFor(st, false),
      ...(at1 ? { at: at1 } : {}),
      title: 'Dollars collected from your account',
      detail,
    });
  }

  // Hop 2
  {
    const skip = failedEarly;
    const st = transfer?.status ?? 'waiting';
    const done = st === 'final';
    let detail = 'Sending';
    if (st === 'confirming') {
      detail = `Confirming (${transfer?.confirmations ?? 0} of 3)`;
    }
    if (done) detail = `Arrived${transfer?.updatedAt ? ` · ${fmtTime(transfer.updatedAt)}` : ''}`;
    if (st === 'checking') {
      detail =
        "The network hasn't answered yet. We're checking before doing anything else. Nothing will be sent twice.";
    }
    if (transfer?.slow && !done && !skip) {
      detail += '. Taking longer than usual. Nothing is wrong yet.';
    }
    if (skip) detail = 'Not needed';
    const at2 = done ? fmtTime(transfer?.updatedAt) : undefined;
    steps.push({
      tone: (skip ? 'info' : done ? 'success' : legTone(st)) as Tone,
      index: '02',
      word: wordFor(st, skip),
      ...(at2 ? { at: at2 } : {}),
      title: 'Funds moving to Mexico',
      detail,
      dashed: skip,
    });
  }

  // Hop 3
  {
    const skip = failedEarly;
    const st = deposit?.status ?? 'waiting';
    const done = st === 'succeeded';
    const fail = st === 'failed';
    let detail = "The supplier's bank is processing the deposit";
    if (done)
      detail = `${receive} deposited${deposit?.updatedAt ? ` · ${fmtTime(deposit.updatedAt)}` : ''}`;
    if (fail) detail = 'The bank rejected the account details. Nothing was deposited.';
    if (deposit?.slow && !done && !fail && !skip) {
      detail += '. Taking longer than usual. Nothing is wrong yet.';
    }
    if (skip) detail = 'Not needed';
    const at3 = done || fail ? fmtTime(deposit?.updatedAt) : undefined;
    steps.push({
      tone: skip ? 'info' : fail ? 'danger' : done ? 'success' : legTone(st),
      index: '03',
      word: wordFor(st, skip),
      ...(at3 ? { at: at3 } : {}),
      title: `Pesos deposited to ${recipientMask}`,
      detail,
      dashed: skip,
    });
  }

  // Refund
  if (refunding || refund?.status === 'succeeded' || refund?.attempt) {
    const st = refund?.status ?? 'waiting';
    const done = st === 'succeeded';
    let detail = `Returning ${send}, fee included, to ${fundingMask}`;
    if (done)
      detail = `Refunded ${send}${refund?.updatedAt ? ` · ${fmtTime(refund.updatedAt)}` : ''}`;
    const atR = done ? fmtTime(refund?.updatedAt) : undefined;
    steps.push({
      tone: done ? 'success' : 'caution',
      index: '↺',
      word: wordFor(st, false),
      ...(atR ? { at: atR } : {}),
      title: 'Refund to your account',
      detail,
    });
  }

  return steps;
}

export function payoutBanner(payout: Payout): {
  tone: Tone;
  label: string;
  title: string;
  body: string;
} {
  const checking = payout.legs.some((l) => l.status === 'checking');
  if (checking) {
    return {
      tone: 'caution',
      label: 'Checking',
      title: 'Confirming where your funds are.',
      body: "Don't send this payout again.",
    };
  }
  switch (payout.status) {
    case 'delivered':
      return {
        tone: 'success',
        label: '✓ Delivered',
        title: formatMinor(payout.receiveMinor, 'MXN'),
        body: `Arrived${payout.finishedAt ? ` · ${fmtTime(payout.finishedAt)}` : ''}`,
      };
    case 'failed':
      return {
        tone: 'danger',
        label: 'Not sent',
        title: 'Your bank declined the debit.',
        body: 'No money left your account and nothing was charged.',
      };
    case 'refunding':
      return {
        tone: 'caution',
        label: 'Refunding',
        title: "Couldn't deliver. Refunding you.",
        body: `Returning ${formatMinor(payout.sendMinor, 'USD')}, fee included.`,
      };
    case 'refunded':
      return {
        tone: 'caution',
        label: '↺ Refunded in full',
        title: `Returned ${formatMinor(payout.sendMinor, 'USD')}, fee included.`,
        body: 'The supplier received nothing. Check their bank details before sending again.',
      };
    default:
      return {
        tone: 'info',
        label: 'In progress',
        title: 'In progress.',
        body: 'You can close this page. The status is saved.',
      };
  }
}
