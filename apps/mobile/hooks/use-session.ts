import { useQuery } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const response = await apiClient.auth.session.$get();
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) throw new Error('Session request failed');
      const body = await response.json();
      return body.user;
    },
  });
}
