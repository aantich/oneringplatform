import { BadRequestException, Injectable } from '@nestjs/common';
import type { ApplicationProfile, ApplicationType } from './browser-app.domain.js';

export interface ApplicationGeneratorManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  supportedApplicationTypes: ApplicationType[];
  available: boolean;
  capabilities: string[];
}

@Injectable()
export class ApplicationGeneratorRegistry {
  private readonly manifests: ApplicationGeneratorManifest[] = [{
    id: 'browser-data',
    name: 'Browser-native Mongo application',
    version: '1',
    description: 'React UI, browser-owned workflows and agent loops, with managed identity, security, Mongo data and connector gateways.',
    supportedApplicationTypes: ['browser_data'],
    available: true,
    capabilities: ['browser-ui', 'mongo-data', 'browser-agents', 'managed-auth', 'managed-preview'],
  }, {
    id: 'full-stack',
    name: 'Full-stack application',
    version: 'planned',
    description: 'Specification support is available; code generation will be added as a separate module.',
    supportedApplicationTypes: ['full_stack', 'api_service'],
    available: false,
    capabilities: ['specification-only'],
  }, {
    id: 'workflow-automation',
    name: 'Workflow automation',
    version: 'planned',
    description: 'Specification support is available; durable workflow generation is planned.',
    supportedApplicationTypes: ['workflow_automation'],
    available: false,
    capabilities: ['specification-only'],
  }, {
    id: 'mobile',
    name: 'Mobile application',
    version: 'planned',
    description: 'Specification support is available; mobile generation is planned.',
    supportedApplicationTypes: ['mobile'],
    available: false,
    capabilities: ['specification-only'],
  }];

  list(): ApplicationGeneratorManifest[] {
    return structuredClone(this.manifests);
  }

  generatorFor(profile: ApplicationProfile): ApplicationGeneratorManifest | undefined {
    return this.manifests.find((manifest) => manifest.supportedApplicationTypes.includes(profile.applicationType));
  }

  requireAvailable(generatorId: string | undefined, profile: ApplicationProfile): ApplicationGeneratorManifest {
    const manifest = this.manifests.find((candidate) => candidate.id === generatorId);
    if (!manifest || !manifest.supportedApplicationTypes.includes(profile.applicationType)) {
      throw new BadRequestException(`No compatible generator is selected for ${profile.applicationType.replaceAll('_', ' ')}`);
    }
    if (!manifest.available) throw new BadRequestException(`${manifest.name} generation is not available yet; continue refining the application specification`);
    return manifest;
  }
}
