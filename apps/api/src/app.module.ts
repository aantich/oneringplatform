import { Module } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { ApplicationGeneratorRegistry } from './application-generator.registry.js';
import { ApplicationDiscoveryService } from './application-discovery.service.js';
import { BrowserAppBuildService } from './browser-app-build.service.js';
import { BrowserAppController } from './browser-app.controller.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { BrowserAppRuntimeController } from './browser-app-runtime.controller.js';
import { BrowserAppRuntimeService } from './browser-app-runtime.service.js';
import { BrowserAppService } from './browser-app.service.js';
import { BrowserAppThemeCompilerService } from './browser-app-theme-compiler.service.js';
import { BrowserAppThemeService } from './browser-app-theme.service.js';
import { BrowserAppTenancyService } from './browser-app-tenancy.service.js';
import { ControlPlaneAuthGuard } from './control-plane-auth.guard.js';
import { ControlPlaneIdentityService } from './control-plane-identity.service.js';
import { OrganizationAuthController } from './organization-auth.controller.js';
import { OrganizationAuthService } from './organization-auth.service.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { StoreService } from './store.service.js';

@Module({
  controllers: [PlatformController, OrganizationController, OrganizationAuthController, BrowserAppController, BrowserAppRuntimeController],
  providers: [
    StoreService,
    AiService,
    ApplicationGeneratorRegistry,
    ApplicationDiscoveryService,
    PlatformService,
    BrowserAppRepository,
    BrowserAppThemeCompilerService,
    BrowserAppBuildService,
    BrowserAppThemeService,
    BrowserAppTenancyService,
    ControlPlaneAuthGuard,
    ControlPlaneIdentityService,
    OrganizationService,
    OrganizationAuthService,
    BrowserAppRuntimeService,
    BrowserAppService,
  ],
})
export class AppModule {}
