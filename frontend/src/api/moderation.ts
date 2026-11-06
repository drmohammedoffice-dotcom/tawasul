import { apiData } from '@/api/http';

export function fetchModerationQueues() {
  return apiData<{
    pending: any[];
    flagged: any[];
    hidden: any[];
    appeals: any[];
    reports: any[];
    critical: any[];
  }>('/moderation/admin/queues');
}

export function fetchModerationCase(id: string) {
  return apiData<any>(`/moderation/admin/cases/${id}`);
}

export function decideModerationCase(
  id: string,
  body: { action: string; note?: string; category?: string }
) {
  return apiData<any>(`/moderation/admin/cases/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function resolveModerationAppeal(id: string, body: { approve: boolean; note?: string }) {
  return apiData<any>(`/moderation/admin/appeals/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function fetchModerationPolicy() {
  return apiData<any>('/moderation/admin/policy');
}

export function fileContentReport(body: {
  targetType: string;
  targetId: string;
  reason: string;
  details?: string;
}) {
  return apiData<any>('/moderation/reports', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function fetchOwnerModerationStatus(kind: string, id: string) {
  return apiData<any>(`/moderation/me/content/${kind}/${id}`);
}

export function submitAppeal(caseId: string, statement: string) {
  return apiData<any>(`/moderation/cases/${caseId}/appeals`, {
    method: 'POST',
    body: JSON.stringify({ statement })
  });
}

export function fetchAccountTransparency() {
  return apiData<any>('/moderation/me/account');
}

export function fetchModerationQuality(days = 30) {
  return apiData<any>(`/moderation/admin/quality?days=${days}`);
}

export function fetchModerationIncidents() {
  return apiData<any>('/moderation/admin/incidents');
}

export function setModerationShadow(body: { enabled: boolean; shadowPolicyVersionId?: string | null }) {
  return apiData<any>('/moderation/admin/shadow', {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function assignModerationCase(id: string, reviewerId?: string) {
  return apiData<any>(`/moderation/admin/cases/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify({ reviewerId })
  });
}
