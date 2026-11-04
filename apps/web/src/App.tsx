import { type Recipient, RecipientSchema } from '@payout/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { NewPayout } from './screens/NewPayout.tsx';
import { Ops } from './screens/Ops.tsx';
import { PayoutDetail } from './screens/PayoutDetail.tsx';
import { PayoutList } from './screens/PayoutList.tsx';
import { request } from './state/api.ts';
import { useRoute } from './state/route.ts';
import { SideNav } from './ui/SideNav.tsx';

const RecipientsSchema = z.array(RecipientSchema);

export function App() {
  const route = useRoute();
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  useEffect(() => {
    void request('/recipients', { method: 'GET', schema: RecipientsSchema }).then((res) => {
      if (res.ok) setRecipients(res.data);
    });
  }, []);

  return (
    <div className="layout">
      <SideNav current={route} />
      <main className="appMain">
        {route.name === 'list' ? <PayoutList recipients={recipients} /> : null}
        {route.name === 'new' ? <NewPayout recipients={recipients} /> : null}
        {route.name === 'payout' ? <PayoutDetail id={route.id} recipients={recipients} /> : null}
        {route.name === 'ops' ? <Ops /> : null}
      </main>
    </div>
  );
}
