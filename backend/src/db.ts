import postgres from 'postgres';
import { z } from 'zod';
import { step } from './activity.ts';
import type { History } from './karma.ts';

const { DATABASE_URL } = z.object({ DATABASE_URL: z.url() }).parse(process.env);

const sql = postgres(DATABASE_URL, { prepare: false, transform: postgres.camel });

export type Customer = History & { clientId: string; name: string };
export type Verdict = 'genuine' | 'fake' | 'low_confidence';

const COLUMNS = sql`client_id, name, total_orders, problem_orders, flagged_reports`;
const describe = (c?: Customer) => (c ? `${c.name} · ${c.totalOrders} orders · ${c.problemOrders} problems · ${c.flaggedReports} flagged` : 'not found');

export const listCustomers = () => sql<Pick<Customer, 'clientId' | 'name'>[]>`select client_id, name from customers order by client_id`;

export const getCustomer = (clientId: string) =>
  step('db', 'SELECT customer', { client_id: clientId },
    async () => (await sql<Customer[]>`select ${COLUMNS} from customers where client_id = ${clientId}`)[0],
    describe);

export const recordComplaint = (clientId: string) =>
  step('db', 'UPDATE customers', { client_id: clientId, set: 'problem_orders + 1' },
    async () => (await sql<Customer[]>`
      update customers set problem_orders = least(problem_orders + 1, total_orders)
      where client_id = ${clientId} returning ${COLUMNS}`)[0],
    describe);

export const reviewComplaint = (chatId: string, clientId: string, verdict: Verdict) =>
  step('db', 'BEGIN · INSERT review · UPDATE customers · COMMIT', { client_id: clientId, verdict },
    () => sql.begin(async (tx) => {
      await tx`insert into reviews (chat_id, client_id, verdict) values (${chatId}, ${clientId}, ${verdict})`;
      const [c] = verdict === 'genuine'
        ? await tx<Customer[]>`select ${COLUMNS} from customers where client_id = ${clientId}`
        : await tx<Customer[]>`update customers set flagged_reports = flagged_reports + 1 where client_id = ${clientId} returning ${COLUMNS}`;
      return c;
    }),
    describe);
