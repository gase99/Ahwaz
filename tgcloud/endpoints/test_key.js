import { EndpointError } from 'sdk';
import {
  buildUserProvidersSnapshot,
  ensureUser,
} from '../lib/services/auth-service.js';
import { testProviderConnection } from '../lib/services/key-test-service.js';

export default async function testKeyEndpoint(input, ctx) {
  const caller = ctx?.initData?.user;
  if (!caller || !caller.id) {
    throw new EndpointError('لطفاً استودیو کدنویسی را از داخل تلگرام باز کنید.', {
      code: 'UNAUTHORIZED',
    });
  }

  const userRow = await ensureUser(caller);
  if (!userRow.isAdmin && !userRow.isAllowed) {
    throw new EndpointError('حساب کاربری شما توسط ادمین تایید نشده است.', {
      code: 'FORBIDDEN',
    });
  }

  const providerId = String(input?.providerId || userRow.provider || 'opencode').trim();

  const result = await testProviderConnection({
    userRow,
    providerId,
    apiKey: input?.apiKey || '',
    baseUrl: input?.baseUrl || '',
    persistResult: true,
  });

  const providers = await buildUserProvidersSnapshot(userRow);

  return {
    ok: true,
    ...result,
    providers,
  };
}
