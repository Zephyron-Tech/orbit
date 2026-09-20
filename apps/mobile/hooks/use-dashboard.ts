import { useQuery } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { DashboardResponse } from '../lib/response-types';

export interface DashboardParams {
  period?: string;
}

export function useDashboard(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', params],
    queryFn: async (): Promise<DashboardResponse> => {
      const response = await apiClient.dashboard.$get({ query: { period: params.period ?? '' } });
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) throw new Error('Dashboard request failed');
      return response.json() as Promise<DashboardResponse>;
    },
  });
}
