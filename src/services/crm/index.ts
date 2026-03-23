import { CRMAdapter } from './CRMAdapter';
import { GoHighLevelAdapter } from './GoHighLevelAdapter';
import { HubSpotAdapter } from './HubSpotAdapter';
import { CRMProvider } from '../../types';

export function createCRMAdapter(provider: CRMProvider, credentials?: Record<string, string>): CRMAdapter {
  switch (provider) {
    case 'gohighlevel':
      return new GoHighLevelAdapter(credentials?.apiKey, credentials?.locationId);
    case 'hubspot':
      return new HubSpotAdapter(credentials?.accessToken);
    default:
      throw new Error(`Unsupported CRM provider: ${provider}`);
  }
}

export { CRMAdapter } from './CRMAdapter';
export { GoHighLevelAdapter } from './GoHighLevelAdapter';
export { HubSpotAdapter } from './HubSpotAdapter';
